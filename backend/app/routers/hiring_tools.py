import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agent import run_agent
from app.ai.base import AIError, AIInputTooLong
from app.ai.factory import get_llm
from app.ai.job_language import check_description
from app.ai.schemas import JobDescriptionDraft
from app.auth import current_org
from app.db import SessionLocal, get_session
from app.matching.analytics import Applicant, build_analytics
from app.matching.scoring import score_match
from app.matching.service import candidate_features, job_features
from app.models import Application, Job, Organization
from app.routers.jobs import owned_job
from app.schemas import (
    AgentIn,
    CheckDescriptionIn,
    DescriptionCheck,
    GeneratedDescription,
    GenerateDescriptionIn,
    JobAnalytics,
)

router = APIRouter(tags=["hiring tools"])

WRITER_PROMPT = (
    "You write complete, clear, inclusive job descriptions from the JSON brief in the document. "
    "In about_role, write two or three full sentences. In responsibilities, write four to six "
    "full-sentence duties that are typical for this title and seniority. In requirements, write "
    "one full-sentence bullet for each required skill, naming that skill. State a number of "
    "years only if min_years is in the brief. Put only the brief's nice-to-have skills in "
    "nice_to_have. You may describe "
    "typical duties, but never invent specific facts about the company, benefits, pay, team "
    "size, or extra required technologies. Avoid hype and words like rockstar or ninja."
)


def _render(draft: JobDescriptionDraft) -> str:
    def section(heading: str, items: list[str]) -> str:
        return f"{heading}\n" + "\n".join(f"- {item}" for item in items)

    parts = [
        draft.about_role.strip(),
        section("Responsibilities", draft.responsibilities),
        section("Requirements", draft.requirements),
    ]
    if draft.nice_to_have:
        parts.append(section("Nice to have", draft.nice_to_have))
    return "\n\n".join(parts)


@router.post("/org/jobs/generate-description")
async def generate_description(
    body: GenerateDescriptionIn, org: Organization = Depends(current_org)
) -> GeneratedDescription:
    system = WRITER_PROMPT
    fields = {
        key: value for key, value in body.brief.model_dump().items() if value not in ("", None)
    }
    brief = {
        "required_skills": [],
        "nice_to_have_skills": [],
        **fields,
        "organization": org.name,
    }
    if body.current_description and body.instruction:
        # The instruction is the recruiter's own request, so it belongs with the system prompt.
        system += (
            "\n\nEdit the document's current_description rather than starting again. Keep its "
            "meaning and facts, and apply this request from the recruiter, even where it "
            f"changes how many duties or how much detail you include: {body.instruction}"
        )
        brief["current_description"] = body.current_description
    try:
        draft = await get_llm().extract(system, json.dumps(brief), JobDescriptionDraft)
    except AIInputTooLong as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "This draft is too long to revise"
        ) from exc
    except AIError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The AI writer is unavailable right now. You can write the description yourself.",
        ) from exc
    description = _render(draft)
    check = check_description(description, body.brief.required_skills, body.brief.min_years)
    return GeneratedDescription(title=draft.title, description=description, **check.model_dump())


@router.post("/org/jobs/check-description")
async def check_job_description(
    body: CheckDescriptionIn, _org: Organization = Depends(current_org)
) -> DescriptionCheck:
    return check_description(body.description, body.required_skills)


@router.get("/org/jobs/{job_id}/analytics")
async def job_analytics(
    job: Job = Depends(owned_job), db: AsyncSession = Depends(get_session)
) -> JobAnalytics:
    features = job_features(job)
    rows = await db.scalars(select(Application).where(Application.job_id == job.id))
    applicants = [
        Applicant(
            application_id=a.id,
            candidate_id=a.candidate.id,
            full_name=a.candidate.full_name,
            headline=a.candidate.headline,
            stage=a.stage,
            last_moved_at=a.updated_at,
            skills=frozenset(s.skill.name for s in a.candidate.skills),
            score=score_match(candidate_features(a.candidate), features),
        )
        for a in rows.unique()
    ]
    return build_analytics(features, applicants, datetime.now(UTC))


async def _agent_stream(job_id: uuid.UUID, body: AgentIn) -> AsyncIterator[str]:
    # The request's session is closed before streaming finishes, so this one is separate.
    async with SessionLocal() as db:
        # Enforced by Postgres: nothing in an agent run can write to the database.
        await db.execute(text("SET TRANSACTION READ ONLY"))
        job = await db.get(Job, job_id)
        if job is None:
            return
        async for event in run_agent(db, job, body.messages):
            yield json.dumps(event) + "\n"


@router.post("/org/jobs/{job_id}/agent")
async def job_agent(body: AgentIn, job: Job = Depends(owned_job)) -> StreamingResponse:
    return StreamingResponse(_agent_stream(job.id, body), media_type="application/x-ndjson")
