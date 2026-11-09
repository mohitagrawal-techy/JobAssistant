import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.tasks import parse_job, refresh_job_embedding
from app.auth import current_org, current_user, ensure_email_confirmed
from app.db import escape_like, get_session
from app.fx import to_usd
from app.models import Application, Job, JobSkill, Organization, Skill, User
from app.schemas import (
    JobDraftIn,
    JobIn,
    JobListItem,
    JobOwner,
    JobPublic,
    JobSearchOut,
    JobStatusIn,
    LocationType,
)
from app.serializers import job_owner, job_public
from app.skills import normalize_skill, normalize_skills, resolve_skills

router = APIRouter(tags=["jobs"])

PAGE_SIZE = 20


async def owned_job(
    job_id: uuid.UUID,
    org: Organization = Depends(current_org),
    db: AsyncSession = Depends(get_session),
) -> Job:
    job = await db.get(Job, job_id)
    # A job owned by another organization looks exactly like one that doesn't exist.
    if job is None or job.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


async def _apply_job_fields(db: AsyncSession, job: Job, body: JobIn) -> None:
    if body.salary_min is not None and body.salary_max is not None:
        if body.salary_min > body.salary_max:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Minimum salary is above the maximum"
            )
    for field in (
        "title",
        "description",
        "client_name",
        "location_type",
        "location",
        "tz_min",
        "tz_max",
        "salary_min",
        "salary_max",
        "currency",
        "min_years",
    ):
        setattr(job, field, getattr(body, field))
    job.salary_usd_min = to_usd(body.salary_min, body.currency)
    job.salary_usd_max = to_usd(body.salary_max, body.currency)

    required = normalize_skills(body.required_skills)
    nice = [s for s in normalize_skills(body.nice_to_have_skills) if s not in required]
    ids = await resolve_skills(db, required + nice)
    job.skills = [
        JobSkill(skill_id=ids[name], required=name in required) for name in required + nice
    ]


@router.get("/jobs")
async def search_jobs(
    q: str | None = Query(default=None, max_length=200),
    location_type: LocationType | None = None,
    skill: str | None = Query(default=None, max_length=100),
    min_salary_usd: int | None = Query(default=None, ge=0),
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_session),
) -> JobSearchOut:
    filters = [Job.status == "open"]
    if q:
        pattern = f"%{escape_like(q)}%"
        filters.append(
            or_(Job.title.ilike(pattern, escape="\\"), Job.description.ilike(pattern, escape="\\"))
        )
    if location_type:
        filters.append(Job.location_type == location_type)
    if min_salary_usd is not None:
        filters.append(Job.salary_usd_max >= min_salary_usd)
    if skill:
        filters.append(
            Job.id.in_(
                select(JobSkill.job_id)
                .join(Skill, Skill.id == JobSkill.skill_id)
                .where(Skill.name == normalize_skill(skill))
            )
        )

    total = await db.scalar(select(func.count()).select_from(Job).where(*filters))
    jobs = await db.scalars(
        select(Job)
        .where(*filters)
        .order_by(Job.created_at.desc(), Job.id)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    )
    return JobSearchOut(items=[job_public(job) for job in jobs.unique()], total=total or 0)


@router.get("/org/jobs")
async def organization_jobs(
    org: Organization = Depends(current_org), db: AsyncSession = Depends(get_session)
) -> list[JobListItem]:
    jobs = await db.scalars(
        select(Job).where(Job.org_id == org.id).order_by(Job.created_at.desc(), Job.id)
    )
    counts = await db.execute(
        select(
            Application.job_id,
            func.count(),
            func.count().filter(Application.stage == "applied"),
        )
        .join(Job, Job.id == Application.job_id)
        .where(Job.org_id == org.id)
        .group_by(Application.job_id)
    )
    by_job = {job_id: (total, waiting) for job_id, total, waiting in counts}
    return [
        JobListItem(
            **job_owner(job).model_dump(),
            applicant_count=by_job.get(job.id, (0, 0))[0],
            awaiting_review=by_job.get(job.id, (0, 0))[1],
        )
        for job in jobs.unique()
    ]


@router.post("/org/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobIn,
    background: BackgroundTasks,
    org: Organization = Depends(current_org),
    db: AsyncSession = Depends(get_session),
) -> JobOwner:
    """Create a draft from fields that are already structured, such as the AI job writer's."""
    job = Job(org_id=org.id, description=body.description, status="draft", parse_status="none")
    db.add(job)
    await db.flush()
    await db.refresh(job, ["organization", "skills"])
    await _apply_job_fields(db, job, body)
    await db.commit()
    await db.refresh(job, ["organization", "skills"])
    background.add_task(refresh_job_embedding, job.id)
    return job_owner(job)


@router.post("/org/jobs/draft", status_code=status.HTTP_202_ACCEPTED)
async def create_job_from_description(
    body: JobDraftIn,
    background: BackgroundTasks,
    org: Organization = Depends(current_org),
    db: AsyncSession = Depends(get_session),
) -> JobOwner:
    """Create a draft from a pasted description. The recruiter reviews it before publishing."""
    job = Job(
        org_id=org.id,
        description=body.description,
        client_name=body.client_name,
        status="draft",
        parse_status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job, ["organization", "skills"])
    background.add_task(parse_job, job.id)
    return job_owner(job)


@router.get("/org/jobs/{job_id}")
async def get_owned_job(job: Job = Depends(owned_job)) -> JobOwner:
    return job_owner(job)


@router.put("/org/jobs/{job_id}")
async def update_job(
    body: JobIn,
    background: BackgroundTasks,
    job: Job = Depends(owned_job),
    db: AsyncSession = Depends(get_session),
) -> JobOwner:
    await _apply_job_fields(db, job, body)
    await db.commit()
    await db.refresh(job, ["organization", "skills"])
    background.add_task(refresh_job_embedding, job.id)
    return job_owner(job)


@router.patch("/org/jobs/{job_id}/status")
async def set_job_status(
    body: JobStatusIn,
    background: BackgroundTasks,
    job: Job = Depends(owned_job),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> JobOwner:
    if body.status == "open":
        ensure_email_confirmed(user)
    if body.status == "open" and not job.title:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add a title before publishing")
    job.status = body.status
    await db.commit()
    await db.refresh(job, ["organization", "skills"])
    if body.status == "open" and job.embedding is None:
        background.add_task(refresh_job_embedding, job.id)
    return job_owner(job)


@router.get("/jobs/{job_id}")
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> JobPublic:
    job = await db.get(Job, job_id)
    if job is None or job.status != "open":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job_public(job)
