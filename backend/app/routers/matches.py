import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_org
from app.db import get_session
from app.matching.scoring import Weights, score_match
from app.matching.service import (
    RETRIEVAL_LIMIT,
    candidate_features,
    candidates_for_job,
    explain_match,
    job_features,
    jobs_for_candidate,
)
from app.models import Application, CandidateProfile, Job, Organization
from app.routers.jobs import owned_job
from app.routers.profile import current_profile
from app.schemas import CandidateMatch, ExplanationOut, JobMatch, ScoreOut
from app.serializers import candidate_summary, job_public
from app.skills import normalize_skill

router = APIRouter(tags=["matches"])


def _score_out(score) -> ScoreOut:
    return ScoreOut(**asdict(score))


@router.get("/org/jobs/{job_id}/matches")
async def match_candidates(
    job: Job = Depends(owned_job),
    skills: float = Query(default=50, ge=0, le=100),
    semantic: float = Query(default=25, ge=0, le=100),
    experience: float = Query(default=15, ge=0, le=100),
    logistics: float = Query(default=10, ge=0, le=100),
    q: str | None = Query(default=None, max_length=200),
    skill: str | None = Query(default=None, max_length=100),
    min_years: float | None = Query(default=None, ge=0, le=60),
    all_required: bool = False,
    db: AsyncSession = Depends(get_session),
) -> list[CandidateMatch]:
    weights = Weights(skills, semantic, experience, logistics)
    must_have = {normalize_skill(skill)} if skill and skill.strip() else set()
    if all_required:
        must_have |= {s.skill.name for s in job.skills if s.required}
    ranked = await candidates_for_job(
        db,
        job,
        weights,
        must_have_skills=sorted(must_have),
        min_years=min_years,
        keyword=q.strip() if q else None,
    )
    return [
        CandidateMatch(candidate=candidate_summary(profile), score=_score_out(score))
        for profile, score in ranked
    ]


@router.get("/org/jobs/{job_id}/candidates/{candidate_id}/explanation")
async def explain_for_recruiter(
    candidate_id: uuid.UUID,
    job: Job = Depends(owned_job),
    org: Organization = Depends(current_org),
    db: AsyncSession = Depends(get_session),
) -> ExplanationOut:
    profile = await db.get(CandidateProfile, candidate_id)
    applied = await db.scalar(
        select(Application.id).where(
            Application.candidate_id == candidate_id, Application.job_id == job.id
        )
    )
    # Hidden candidates are visible only to organizations they applied to.
    if profile is None or not (profile.is_visible or applied):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found")
    score = score_match(candidate_features(profile), job_features(job))
    return await explain_match(db, profile, job, score)


@router.get("/matches/jobs")
async def match_jobs(
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> list[JobMatch]:
    ranked = await jobs_for_candidate(db, profile, limit=RETRIEVAL_LIMIT)
    applied = set(
        await db.scalars(select(Application.job_id).where(Application.candidate_id == profile.id))
    )
    return [
        JobMatch(job=job_public(job), score=_score_out(score), applied=job.id in applied)
        for job, score in ranked
    ]


@router.get("/matches/jobs/{job_id}/explanation")
async def explain_for_seeker(
    job_id: uuid.UUID,
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> ExplanationOut:
    job = await db.get(Job, job_id)
    if job is None or job.status != "open":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    score = score_match(candidate_features(profile), job_features(job))
    return await explain_match(db, profile, job, score)
