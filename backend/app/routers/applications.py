import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_confirmed_user, current_org
from app.db import get_session
from app.models import Application, CandidateProfile, Job, Organization, User
from app.routers.jobs import owned_job
from app.routers.profile import current_profile
from app.schemas import ApplicationIn, ApplicationStageIn, RecruiterApplication, SeekerApplication
from app.serializers import candidate_summary, job_public

router = APIRouter(tags=["applications"])


def _seeker_view(application: Application) -> SeekerApplication:
    return SeekerApplication(
        id=application.id,
        job=job_public(application.job),
        stage=application.stage,
        created_at=application.created_at,
        cover_note=application.cover_note,
        via_assistant=application.via_assistant,
    )


def _recruiter_view(application: Application) -> RecruiterApplication:
    return RecruiterApplication(
        id=application.id,
        candidate=candidate_summary(application.candidate),
        stage=application.stage,
        created_at=application.created_at,
        cover_note=application.cover_note,
        via_assistant=application.via_assistant,
    )


@router.post("/applications", status_code=status.HTTP_201_CREATED)
async def apply(
    body: ApplicationIn,
    profile: CandidateProfile = Depends(current_profile),
    _confirmed: User = Depends(current_confirmed_user),
    db: AsyncSession = Depends(get_session),
) -> SeekerApplication:
    job = await db.get(Job, body.job_id)
    if job is None or job.status != "open":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    application = Application(candidate_id=profile.id, job_id=job.id)
    db.add(application)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already applied to this job") from exc
    await db.refresh(application, ["job"])
    return _seeker_view(application)


@router.get("/applications")
async def my_applications(
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> list[SeekerApplication]:
    applications = await db.scalars(
        select(Application)
        .where(Application.candidate_id == profile.id)
        .order_by(Application.created_at.desc())
    )
    return [_seeker_view(a) for a in applications.unique()]


@router.get("/org/jobs/{job_id}/applications")
async def job_applications(
    job: Job = Depends(owned_job), db: AsyncSession = Depends(get_session)
) -> list[RecruiterApplication]:
    applications = await db.scalars(
        select(Application).where(Application.job_id == job.id).order_by(Application.created_at)
    )
    return [_recruiter_view(a) for a in applications.unique()]


@router.patch("/org/applications/{application_id}")
async def move_application(
    application_id: uuid.UUID,
    body: ApplicationStageIn,
    org: Organization = Depends(current_org),
    db: AsyncSession = Depends(get_session),
) -> RecruiterApplication:
    application = await db.get(Application, application_id)
    if application is None or application.job.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    application.stage = body.stage
    await db.commit()
    return _recruiter_view(application)
