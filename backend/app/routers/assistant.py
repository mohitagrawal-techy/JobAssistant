import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import ProfileIncomplete, run_for_candidate
from app.db import get_session
from app.models import Application, AssistantAction, AssistantSettings, CandidateProfile
from app.routers.profile import current_profile
from app.schemas import (
    AssistantActionOut,
    AssistantApproveIn,
    AssistantOut,
    AssistantRunOut,
    AssistantSettingsIn,
    AssistantSettingsOut,
)
from app.serializers import job_public

router = APIRouter(tags=["assistant"])

ACTIVITY_LIMIT = 50


async def _settings_for(db: AsyncSession, profile: CandidateProfile) -> AssistantSettings:
    settings = await db.get(AssistantSettings, profile.id)
    if settings is None:
        settings = AssistantSettings(
            candidate_id=profile.id,
            enabled=False,
            mode="ask",
            min_score=75,
            daily_limit=5,
            require_all_skills=False,
            excluded_companies=[],
        )
        db.add(settings)
        await db.flush()
    return settings


def _settings_out(settings: AssistantSettings) -> AssistantSettingsOut:
    return AssistantSettingsOut(
        enabled=settings.enabled,
        mode=settings.mode,
        min_score=settings.min_score,
        daily_limit=settings.daily_limit,
        require_all_skills=settings.require_all_skills,
        excluded_companies=settings.excluded_companies,
        has_auto_consent=settings.auto_consent_at is not None,
        last_run_at=settings.last_run_at,
    )


def _action_out(action: AssistantAction) -> AssistantActionOut:
    return AssistantActionOut(
        id=action.id,
        job=job_public(action.job),
        score=action.score,
        note=action.note,
        status=action.status,
        applied_automatically=action.applied_automatically,
        created_at=action.created_at,
    )


async def _owned_action(
    action_id: uuid.UUID,
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> AssistantAction:
    action = await db.get(AssistantAction, action_id)
    if action is None or action.candidate_id != profile.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return action


@router.get("/assistant")
async def get_assistant(
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> AssistantOut:
    settings = await _settings_for(db, profile)
    await db.commit()
    actions = (
        (
            await db.scalars(
                select(AssistantAction)
                .where(AssistantAction.candidate_id == profile.id)
                .order_by(AssistantAction.created_at.desc())
                .limit(ACTIVITY_LIMIT)
            )
        )
        .unique()
        .all()
    )
    return AssistantOut(
        settings=_settings_out(settings),
        pending=[
            _action_out(a) for a in actions if a.status == "pending" and a.job.status == "open"
        ],
        activity=[_action_out(a) for a in actions if a.status != "pending"],
    )


@router.put("/assistant/settings")
async def update_settings(
    body: AssistantSettingsIn,
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> AssistantSettingsOut:
    settings = await _settings_for(db, profile)
    if body.mode == "auto":
        if not body.auto_consent and settings.auto_consent_at is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Give permission before letting the assistant apply automatically",
            )
        settings.auto_consent_at = settings.auto_consent_at or datetime.now(UTC)
    else:
        # Permission is specific to automatic mode, so leaving it means asking again later.
        settings.auto_consent_at = None
    settings.enabled = body.enabled
    settings.mode = body.mode
    settings.min_score = body.min_score
    settings.daily_limit = body.daily_limit
    settings.require_all_skills = body.require_all_skills
    settings.excluded_companies = [n.strip() for n in body.excluded_companies if n.strip()]
    await db.commit()
    return _settings_out(settings)


@router.post("/assistant/run")
async def run_assistant(
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> AssistantRunOut:
    settings = await _settings_for(db, profile)
    if not settings.enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Turn the assistant on first")
    try:
        result = await run_for_candidate(db, profile, settings)
    except ProfileIncomplete as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return AssistantRunOut(applied=result.applied, suggested=result.suggested)


@router.post("/assistant/actions/{action_id}/approve")
async def approve_action(
    body: AssistantApproveIn,
    action: AssistantAction = Depends(_owned_action),
    db: AsyncSession = Depends(get_session),
) -> AssistantActionOut:
    if action.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This has already been handled")
    if action.job.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "This job is no longer open")
    existing = await db.scalar(
        select(Application.id).where(
            Application.candidate_id == action.candidate_id, Application.job_id == action.job_id
        )
    )
    if existing is not None:
        action.status = "skipped"
        await db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already applied to this job")
    action.note = body.note
    action.status = "applied"
    db.add(
        Application(
            candidate_id=action.candidate_id,
            job_id=action.job_id,
            cover_note=body.note,
            via_assistant=True,
        )
    )
    await db.commit()
    return _action_out(action)


@router.post("/assistant/actions/{action_id}/skip")
async def skip_action(
    action: AssistantAction = Depends(_owned_action),
    db: AsyncSession = Depends(get_session),
) -> AssistantActionOut:
    if action.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This has already been handled")
    action.status = "skipped"
    await db.commit()
    return _action_out(action)


@router.post("/assistant/actions/{action_id}/withdraw")
async def withdraw_action(
    action: AssistantAction = Depends(_owned_action),
    db: AsyncSession = Depends(get_session),
) -> AssistantActionOut:
    if action.status != "applied":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only submitted applications can be withdrawn"
        )
    application = await db.scalar(
        select(Application).where(
            Application.candidate_id == action.candidate_id, Application.job_id == action.job_id
        )
    )
    if application is not None:
        if application.stage != "applied":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The employer has already started reviewing this application",
            )
        await db.delete(application)
    action.status = "withdrawn"
    await db.commit()
    return _action_out(action)
