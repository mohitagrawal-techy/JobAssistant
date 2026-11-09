import hashlib
import json
from dataclasses import asdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIError
from app.ai.factory import get_llm
from app.ai.schemas import MatchExplanation
from app.db import escape_like
from app.matching.scoring import (
    CandidateFeatures,
    JobFeatures,
    ScoreBreakdown,
    Weights,
    score_match,
)
from app.models import CandidateProfile, CandidateSkill, Job, MatchExplanationRecord, Skill
from app.schemas import ExplanationOut, ExplanationPoint

RETRIEVAL_LIMIT = 50
# Discovered candidates need at least this share of a job's minimum years.
MIN_EXPERIENCE_SHARE = 0.5
ACCEPTED_PREFERENCES = {
    "remote": ("remote", "any"),
    "hybrid": ("hybrid", "any"),
    "onsite": ("onsite", "any"),
}
EXPLANATION_PROMPT = (
    "You explain to a recruiter and a job seeker why a candidate does or doesn't fit a job. "
    "The score is already calculated, so never change or dispute it. For strengths use only "
    "skills in matched_skills, and for gaps use only skills in missing_skills. You only know "
    "whether a skill is listed, so never claim proficiency, projects, or depth of experience. "
    "Say what the job needs the skill for at most. Be factual and brief. Never mention a "
    "person's name, gender, age, or nationality."
)


def _embedding(vector) -> tuple[float, ...] | None:
    return None if vector is None else tuple(float(value) for value in vector)


def candidate_features(profile: CandidateProfile) -> CandidateFeatures:
    return CandidateFeatures(
        skills=frozenset(s.skill.name for s in profile.skills),
        years_experience=profile.years_experience,
        remote_preference=profile.remote_preference,
        utc_offset=profile.utc_offset,
        salary_usd=profile.salary_usd,
        embedding=_embedding(profile.embedding),
    )


def job_features(job: Job) -> JobFeatures:
    return JobFeatures(
        required_skills=frozenset(s.skill.name for s in job.skills if s.required),
        nice_skills=frozenset(s.skill.name for s in job.skills if not s.required),
        min_years=job.min_years,
        location_type=job.location_type,
        tz_min=job.tz_min,
        tz_max=job.tz_max,
        salary_usd_max=job.salary_usd_max,
        embedding=_embedding(job.embedding),
    )


async def candidates_for_job(
    db: AsyncSession,
    job: Job,
    weights: Weights = Weights(),
    limit: int = 20,
    must_have_skills: list[str] | None = None,
    min_years: float | None = None,
    keyword: str | None = None,
) -> list[tuple[CandidateProfile, ScoreBreakdown]]:
    query = select(CandidateProfile).where(
        CandidateProfile.is_visible.is_(True),
        CandidateProfile.remote_preference.in_(ACCEPTED_PREFERENCES[job.location_type]),
    )
    if job.tz_min is not None and job.tz_max is not None:
        query = query.where(
            or_(
                CandidateProfile.utc_offset.is_(None),
                CandidateProfile.utc_offset.between(job.tz_min, job.tz_max),
            )
        )
    if job.salary_usd_max is not None:
        query = query.where(
            or_(
                CandidateProfile.salary_usd.is_(None),
                CandidateProfile.salary_usd <= job.salary_usd_max,
            )
        )
    if job.min_years:
        query = query.where(
            or_(
                CandidateProfile.years_experience.is_(None),
                CandidateProfile.years_experience >= job.min_years * MIN_EXPERIENCE_SHARE,
            )
        )
    if min_years:
        query = query.where(CandidateProfile.years_experience >= min_years)
    if keyword:
        pattern = f"%{escape_like(keyword)}%"
        query = query.where(
            or_(
                CandidateProfile.full_name.ilike(pattern, escape="\\"),
                CandidateProfile.headline.ilike(pattern, escape="\\"),
            )
        )
    for skill in must_have_skills or []:
        query = query.where(
            CandidateProfile.id.in_(
                select(CandidateSkill.candidate_id)
                .join(Skill, Skill.id == CandidateSkill.skill_id)
                .where(Skill.name == skill)
            )
        )
    if job.embedding is not None:
        query = query.order_by(
            CandidateProfile.embedding.cosine_distance(job.embedding).nulls_last()
        )
    else:
        query = query.order_by(CandidateProfile.updated_at.desc())

    profiles = (await db.scalars(query.limit(RETRIEVAL_LIMIT))).unique().all()
    features = job_features(job)
    scored = [(p, score_match(candidate_features(p), features, weights)) for p in profiles]
    scored.sort(key=lambda item: (-item[1].total, str(item[0].id)))
    return scored[:limit]


async def jobs_for_candidate(
    db: AsyncSession, profile: CandidateProfile, limit: int = 20
) -> list[tuple[Job, ScoreBreakdown]]:
    query = select(Job).where(Job.status == "open")
    if profile.remote_preference != "any":
        query = query.where(Job.location_type == profile.remote_preference)
    if profile.utc_offset is not None:
        query = query.where(
            or_(
                Job.tz_min.is_(None),
                Job.tz_max.is_(None),
                Job.tz_min <= profile.utc_offset,
            ),
            or_(
                Job.tz_min.is_(None),
                Job.tz_max.is_(None),
                Job.tz_max >= profile.utc_offset,
            ),
        )
    if profile.salary_usd is not None:
        query = query.where(
            or_(Job.salary_usd_max.is_(None), Job.salary_usd_max >= profile.salary_usd)
        )
    if profile.embedding is not None:
        query = query.order_by(Job.embedding.cosine_distance(profile.embedding).nulls_last())
    else:
        query = query.order_by(Job.created_at.desc())

    jobs = (await db.scalars(query.limit(RETRIEVAL_LIMIT))).unique().all()
    features = candidate_features(profile)
    scored = [(job, score_match(features, job_features(job))) for job in jobs]
    scored.sort(key=lambda item: (-item[1].total, str(item[0].id)))
    return scored[:limit]


def _template_explanation(score: ScoreBreakdown) -> ExplanationOut:
    """Used when the LLM is unavailable, built directly from the score breakdown."""
    matched = score.matched_required + score.matched_nice
    missing = score.missing_required + score.missing_nice
    return ExplanationOut(
        strengths=[
            ExplanationPoint(skill=skill, reason="This skill is on the profile and the job.")
            for skill in matched
        ],
        gaps=[
            ExplanationPoint(skill=skill, reason="The job asks for this; it isn't on the profile.")
            for skill in missing
        ],
        summary=(
            f"Overall match {score.total} out of 100, with {len(score.matched_required)} of "
            f"{len(score.matched_required) + len(score.missing_required)} required skills matched."
        ),
        source="template",
    )


def _keep_known_skills(items, allowed: set[str]) -> list[ExplanationPoint]:
    """Drop anything the model says about skills that aren't in the computed breakdown."""
    return [
        ExplanationPoint(skill=item.skill.lower(), reason=item.reason)
        for item in items
        if item.skill.lower() in allowed
    ]


async def explain_match(
    db: AsyncSession, profile: CandidateProfile, job: Job, score: ScoreBreakdown
) -> ExplanationOut:
    llm = get_llm()
    facts = {
        "job_title": job.title,
        "candidate_headline": profile.headline,
        "total_score": score.total,
        "score_parts": {
            "skills": score.skills,
            "semantic": score.semantic,
            "experience": score.experience,
            "logistics": score.logistics,
        },
        "matched_skills": sorted(score.matched_required + score.matched_nice),
        "missing_skills": sorted(score.missing_required + score.missing_nice),
        "required_missing": sorted(score.missing_required),
    }
    input_hash = hashlib.sha256(
        json.dumps(
            {"facts": facts, "score": asdict(score), "model": llm.model}, sort_keys=True
        ).encode()
    ).hexdigest()

    record = await db.get(MatchExplanationRecord, (profile.id, job.id))
    if record is not None and record.input_hash == input_hash:
        return ExplanationOut(
            strengths=record.strengths, gaps=record.gaps, summary=record.summary, source="ai"
        )

    try:
        result = await llm.extract(EXPLANATION_PROMPT, json.dumps(facts), MatchExplanation)
    except AIError:
        return _template_explanation(score)

    strengths = _keep_known_skills(result.strengths, set(facts["matched_skills"]))
    gaps = _keep_known_skills(result.gaps, set(facts["missing_skills"]))
    values = {
        "input_hash": input_hash,
        "strengths": [point.model_dump() for point in strengths],
        "gaps": [point.model_dump() for point in gaps],
        "summary": result.summary,
    }
    if record is None:
        db.add(MatchExplanationRecord(candidate_id=profile.id, job_id=job.id, **values))
    else:
        for key, value in values.items():
            setattr(record, key, value)
    await db.commit()
    return ExplanationOut(strengths=strengths, gaps=gaps, summary=result.summary, source="ai")
