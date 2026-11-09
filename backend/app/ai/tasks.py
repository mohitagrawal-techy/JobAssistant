"""Background jobs. Each opens its own session; AI failures are recorded, not raised."""

import asyncio
import logging
import uuid

from app.ai.base import AIError, AIInputTooLong, AIUnavailable
from app.ai.documents import DocumentError, extract_text
from app.ai.factory import get_embedder, get_llm
from app.ai.schemas import JobExtraction, ResumeExtraction
from app.db import SessionLocal
from app.fx import USD_PER_UNIT, to_usd
from app.models import CandidateProfile, Job, JobSkill, Resume
from app.skills import normalize_skills, resolve_skills
from app.storage import get_storage

logger = logging.getLogger(__name__)

RESUME_PROMPT = (
    "You extract structured data from resumes. Use only information stated in the document. "
    "Do not infer gender, age, nationality, or marital status."
)
JOB_PROMPT = (
    "You extract structured data from job descriptions. Use only information stated in the "
    "document, and use null for anything not stated."
)


def _failure_message(exc: Exception) -> str:
    if isinstance(exc, DocumentError):
        return str(exc)
    if isinstance(exc, AIUnavailable):
        return "The AI service is unavailable. Please fill in the form."
    if isinstance(exc, AIInputTooLong):
        return "This document is too long to process. Please fill in the form."
    return "We couldn't read this document reliably. Please fill in the form."


async def parse_resume(resume_id: uuid.UUID, extension: str) -> None:
    """Store extracted data for the user to review. The profile changes only when they save."""
    async with SessionLocal() as db:
        resume = await db.get(Resume, resume_id)
        if resume is None:
            return
        resume.parse_status = "processing"
        await db.commit()
        try:
            data = await get_storage().read(resume.file_path)
            text = await asyncio.to_thread(extract_text, data, extension)
            extraction = await get_llm().extract(RESUME_PROMPT, text, ResumeExtraction)
        except (AIError, DocumentError) as exc:
            logger.warning("Resume %s failed to parse: %s", resume_id, exc)
            resume.parse_status = "failed"
            resume.parse_error = _failure_message(exc)
        else:
            resume.extracted = extraction.model_dump()
            resume.parse_status = "done"
        await db.commit()


async def parse_job(job_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        job.parse_status = "processing"
        await db.commit()
        try:
            extraction = await get_llm().extract(JOB_PROMPT, job.description, JobExtraction)
        except AIError as exc:
            logger.warning("Job %s failed to parse: %s", job_id, exc)
            job.parse_status = "failed"
            job.parse_error = _failure_message(exc)
            await db.commit()
            return

        job.title = extraction.title[:200]
        job.min_years = extraction.min_years
        job.location_type = extraction.location_type or job.location_type
        job.location = (extraction.location or "")[:200]
        currency = (extraction.currency or "").upper()
        if currency in USD_PER_UNIT and extraction.salary_min is not None:
            job.currency = currency
            job.salary_min = extraction.salary_min
            job.salary_max = extraction.salary_max
            job.salary_usd_min = to_usd(extraction.salary_min, currency)
            job.salary_usd_max = to_usd(extraction.salary_max, currency)

        required = normalize_skills(extraction.required_skills)
        nice = [s for s in normalize_skills(extraction.nice_to_have_skills) if s not in required]
        ids = await resolve_skills(db, required + nice)
        job.skills = [
            JobSkill(skill_id=ids[name], required=name in required) for name in required + nice
        ]
        job.parse_status = "done"
        await db.commit()
    await refresh_job_embedding(job_id)


def candidate_embedding_text(profile: CandidateProfile) -> str:
    skills = ", ".join(sorted(s.skill.name for s in profile.skills))
    return f"{profile.headline}\nSkills: {skills}\n{profile.summary}"


def job_embedding_text(job: Job) -> str:
    skills = ", ".join(sorted(s.skill.name for s in job.skills))
    return f"{job.title}\nSkills: {skills}\n{job.description}"


async def refresh_candidate_embedding(candidate_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        profile = await db.get(CandidateProfile, candidate_id)
        if profile is None:
            return
        embedder = get_embedder()
        try:
            [vector] = await embedder.embed([candidate_embedding_text(profile)], "document")
        except AIError as exc:
            # Matching still works: unembedded profiles rank last and score 0 on similarity.
            logger.warning("Could not embed candidate %s: %s", candidate_id, exc)
            return
        profile.embedding = vector
        profile.embedding_model = embedder.model
        await db.commit()


async def refresh_job_embedding(job_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        embedder = get_embedder()
        try:
            [vector] = await embedder.embed([job_embedding_text(job)], "query")
        except AIError as exc:
            logger.warning("Could not embed job %s: %s", job_id, exc)
            return
        job.embedding = vector
        job.embedding_model = embedder.model
        await db.commit()
