from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.documents import DocumentError, detect_extension
from app.ai.tasks import parse_resume, refresh_candidate_embedding
from app.auth import clear_session_cookie, current_seeker, current_user
from app.db import get_session
from app.fx import to_usd
from app.models import (
    Application,
    AssistantAction,
    CandidateProfile,
    CandidateSkill,
    Resume,
    User,
)
from app.schemas import ProfileIn, ProfileOut, ResumeOut
from app.serializers import job_public, profile_out
from app.skills import normalize_skill, resolve_skills
from app.storage import get_storage

router = APIRouter(tags=["profile"])

MAX_RESUME_BYTES = 5 * 1024 * 1024


async def current_profile(
    user: User = Depends(current_seeker), db: AsyncSession = Depends(get_session)
) -> CandidateProfile:
    profile = await db.scalar(select(CandidateProfile).where(CandidateProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return profile


@router.get("/profile")
async def get_profile(profile: CandidateProfile = Depends(current_profile)) -> ProfileOut:
    return profile_out(profile)


@router.put("/profile")
async def update_profile(
    body: ProfileIn,
    background: BackgroundTasks,
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> ProfileOut:
    for field in (
        "full_name",
        "headline",
        "summary",
        "years_experience",
        "location",
        "utc_offset",
        "remote_preference",
        "salary_min",
        "currency",
        "is_visible",
    ):
        setattr(profile, field, getattr(body, field))
    profile.salary_usd = to_usd(body.salary_min, body.currency)

    years_by_name = {normalize_skill(s.name): s.years for s in body.skills}
    ids = await resolve_skills(db, list(years_by_name))
    profile.skills = [
        CandidateSkill(skill_id=ids[name], years=years) for name, years in years_by_name.items()
    ]
    await db.commit()
    await db.refresh(profile, ["skills"])
    background.add_task(refresh_candidate_embedding, profile.id)
    return profile_out(profile)


@router.post("/profile/resume", status_code=status.HTTP_202_ACCEPTED)
async def upload_resume(
    file: UploadFile,
    background: BackgroundTasks,
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> ResumeOut:
    data = await file.read(MAX_RESUME_BYTES + 1)
    if len(data) > MAX_RESUME_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Files are limited to 5 MB")
    try:
        extension = detect_extension(data)
    except DocumentError as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(exc)) from exc

    path = await get_storage().save(data, extension)
    resume = Resume(
        candidate_id=profile.id,
        file_path=path,
        filename=(file.filename or "resume")[:255],
        parse_status="pending",
    )
    db.add(resume)
    await db.commit()
    background.add_task(parse_resume, resume.id, extension)
    return ResumeOut.model_validate(resume)


@router.get("/profile/resume")
async def latest_resume(
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> ResumeOut | None:
    resume = await db.scalar(
        select(Resume)
        .where(Resume.candidate_id == profile.id)
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    return ResumeOut.model_validate(resume) if resume else None


@router.get("/profile/export")
async def export_data(
    user: User = Depends(current_seeker),
    profile: CandidateProfile = Depends(current_profile),
    db: AsyncSession = Depends(get_session),
) -> dict:
    resumes = await db.scalars(select(Resume).where(Resume.candidate_id == profile.id))
    applications = await db.scalars(
        select(Application).where(Application.candidate_id == profile.id)
    )
    assistant_actions = await db.scalars(
        select(AssistantAction).where(AssistantAction.candidate_id == profile.id)
    )
    return {
        "account": {"email": user.email, "consent_at": user.consent_at.isoformat()},
        "profile": profile_out(profile).model_dump(mode="json"),
        "resumes": [ResumeOut.model_validate(r).model_dump(mode="json") for r in resumes],
        "applications": [
            {
                "job": job_public(a.job).model_dump(mode="json"),
                "stage": a.stage,
                "applied_at": a.created_at.isoformat(),
            }
            for a in applications.unique()
        ],
        "assistant_actions": [
            {
                "job_title": a.job.title,
                "note": a.note,
                "status": a.status,
                "applied_automatically": a.applied_automatically,
                "created_at": a.created_at.isoformat(),
            }
            for a in assistant_actions.unique()
        ],
    }


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    paths = await db.scalars(
        select(Resume.file_path)
        .join(CandidateProfile, CandidateProfile.id == Resume.candidate_id)
        .where(CandidateProfile.user_id == user.id)
    )
    storage = get_storage()
    for path in paths.all():
        await storage.delete(path)
    await db.delete(user)
    await db.commit()
    clear_session_cookie(response)
