"""Applies to jobs for a job seeker, within rules the seeker sets.

Fixed rules choose every job. AI only writes the cover note, from structured facts: it never
sees the seeker's name or contact details, or the text of a job posting.
"""

import asyncio
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIError
from app.ai.factory import get_llm
from app.ai.schemas import CoverNote
from app.config import get_settings
from app.db import SessionLocal
from app.matching.scoring import ScoreBreakdown
from app.matching.service import MIN_EXPERIENCE_SHARE, RETRIEVAL_LIMIT, jobs_for_candidate
from app.models import (
    Application,
    AssistantAction,
    AssistantSettings,
    CandidateProfile,
    Job,
    User,
)

logger = logging.getLogger(__name__)

NOTE_PROMPT = (
    "You write a short first-person cover note for a job application from the JSON facts in the "
    "document. Write two to four plain sentences. Mention the job title and the matched skills. "
    "Say 'my profile lists' before the skills. Never describe how good the applicant is at "
    "them. Use only these facts. Never claim achievements, employers, or anything else "
    "not given, and don't mention skills the applicant doesn't have. Don't add a greeting, "
    "sign-off, name, or placeholders."
)


_OVERCLAIM = re.compile(
    r"\b(proficien\w*|expert\w*|master\w*|extensive\w*|deep|strong|skilled|adept|seasoned)\b",
    re.IGNORECASE,
)


class ProfileIncomplete(Exception):
    """The profile doesn't have enough to apply with. The message is safe to show."""


@dataclass(frozen=True)
class RunResult:
    applied: int = 0
    suggested: int = 0


def is_eligible(
    settings: AssistantSettings, profile: CandidateProfile, job: Job, score: ScoreBreakdown
) -> bool:
    if score.total < settings.min_score:
        return False
    if settings.require_all_skills and score.missing_required:
        return False
    excluded = {name.strip().lower() for name in settings.excluded_companies}
    if job.organization.name.strip().lower() in excluded:
        return False
    if job.min_years and profile.years_experience is not None:
        if profile.years_experience < job.min_years * MIN_EXPERIENCE_SHARE:
            return False
    return True


async def write_note(profile: CandidateProfile, job: Job, score: ScoreBreakdown) -> str:
    matched = sorted(score.matched_required + score.matched_nice)
    facts = {
        "job_title": job.title,
        "company": job.organization.name,
        "applicant_current_role": profile.headline,
        "years_experience": profile.years_experience,
        "matched_skills": matched,
    }
    skills = f" My profile lists {', '.join(matched)}." if matched else ""
    template = f"I'd like to apply for the {job.title} role at {job.organization.name}.{skills}"
    try:
        result = await get_llm().extract(NOTE_PROMPT, json.dumps(facts), CoverNote)
    except AIError as exc:
        logger.warning("Using the template cover note: %s", exc)
        return template
    # This goes out in the seeker's name, and skill level is something Khoj can't know.
    return template if _OVERCLAIM.search(result.note) else result.note


async def run_for_candidate(
    db: AsyncSession, profile: CandidateProfile, settings: AssistantSettings
) -> RunResult:
    if not profile.full_name.strip() or not profile.skills:
        raise ProfileIncomplete("Add your name and skills to your profile first")

    # Held until commit, so simultaneous runs can't exceed the seeker's daily limit.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"assistant:{profile.id}"},
    )
    now = datetime.now(UTC)
    used_today = await db.scalar(
        select(func.count())
        .select_from(AssistantAction)
        .where(
            AssistantAction.candidate_id == profile.id,
            AssistantAction.created_at >= now - timedelta(hours=24),
            AssistantAction.status != "skipped",
        )
    )
    pending = await db.scalar(
        select(func.count())
        .select_from(AssistantAction)
        .where(AssistantAction.candidate_id == profile.id, AssistantAction.status == "pending")
    )
    remaining = settings.daily_limit - (used_today or 0)
    if settings.mode == "ask":
        remaining = min(remaining, settings.daily_limit - (pending or 0))

    applied_jobs = await db.scalars(
        select(Application.job_id).where(Application.candidate_id == profile.id)
    )
    handled_jobs = await db.scalars(
        select(AssistantAction.job_id).where(AssistantAction.candidate_id == profile.id)
    )
    seen = set(applied_jobs.all()) | set(handled_jobs.all())

    result = RunResult()
    if remaining > 0:
        ranked = await jobs_for_candidate(db, profile, limit=RETRIEVAL_LIMIT)
        chosen = [
            (job, score)
            for job, score in ranked
            if job.id not in seen and is_eligible(settings, profile, job, score)
        ][:remaining]
        automatic = settings.mode == "auto"
        for job, score in chosen:
            note = await write_note(profile, job, score)
            db.add(
                AssistantAction(
                    candidate_id=profile.id,
                    job_id=job.id,
                    score=score.total,
                    note=note,
                    status="applied" if automatic else "pending",
                    applied_automatically=automatic,
                )
            )
            if automatic:
                db.add(
                    Application(
                        candidate_id=profile.id,
                        job_id=job.id,
                        cover_note=note,
                        via_assistant=True,
                    )
                )
        count = len(chosen)
        result = RunResult(applied=count) if automatic else RunResult(suggested=count)

    settings.last_run_at = now
    await db.commit()
    return result


async def run_all_enabled() -> None:
    async with SessionLocal() as db:
        ids: list[uuid.UUID] = list(
            await db.scalars(
                select(AssistantSettings.candidate_id)
                .join(CandidateProfile, CandidateProfile.id == AssistantSettings.candidate_id)
                .join(User, User.id == CandidateProfile.user_id)
                .where(AssistantSettings.enabled.is_(True), User.email_verified_at.is_not(None))
            )
        )
    for candidate_id in ids:
        try:
            async with SessionLocal() as db:
                profile = await db.get(CandidateProfile, candidate_id)
                settings = await db.get(AssistantSettings, candidate_id)
                if profile is not None and settings is not None and settings.enabled:
                    await run_for_candidate(db, profile, settings)
        except ProfileIncomplete:
            continue
        except Exception:  # one seeker's failure mustn't stop everyone else's run
            logger.exception("Assistant run failed for candidate %s", candidate_id)


async def scheduler_loop() -> None:
    interval = get_settings().assistant_interval_seconds
    while True:
        await asyncio.sleep(interval)
        try:
            await run_all_enabled()
        except Exception:
            logger.exception("Assistant scheduler run failed")
