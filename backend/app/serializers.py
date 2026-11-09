from app.models import CandidateProfile, Job
from app.schemas import CandidateSummary, JobOwner, JobPublic, ProfileOut, SkillIn


def _skill_names(job: Job, required: bool) -> list[str]:
    return sorted(s.skill.name for s in job.skills if s.required is required)


def _job_fields(job: Job) -> dict:
    return {
        "id": job.id,
        "organization_name": job.organization.name,
        "title": job.title,
        "description": job.description,
        "location_type": job.location_type,
        "location": job.location,
        "tz_min": job.tz_min,
        "tz_max": job.tz_max,
        "salary_min": job.salary_min,
        "salary_max": job.salary_max,
        "currency": job.currency,
        "min_years": job.min_years,
        "required_skills": _skill_names(job, True),
        "nice_to_have_skills": _skill_names(job, False),
        "created_at": job.created_at,
    }


def job_public(job: Job) -> JobPublic:
    """Public view. Deliberately omits client_name, which agencies keep confidential."""
    return JobPublic(**_job_fields(job))


def job_owner(job: Job) -> JobOwner:
    return JobOwner(
        **_job_fields(job),
        client_name=job.client_name,
        status=job.status,
        parse_status=job.parse_status,
        parse_error=job.parse_error,
    )


def profile_out(profile: CandidateProfile) -> ProfileOut:
    return ProfileOut(
        id=profile.id,
        full_name=profile.full_name,
        headline=profile.headline,
        summary=profile.summary,
        years_experience=profile.years_experience,
        location=profile.location,
        utc_offset=profile.utc_offset,
        remote_preference=profile.remote_preference,
        salary_min=profile.salary_min,
        currency=profile.currency,
        is_visible=profile.is_visible,
        skills=sorted(
            (SkillIn(name=s.skill.name, years=s.years) for s in profile.skills),
            key=lambda skill: skill.name,
        ),
        has_embedding=profile.embedding is not None,
    )


def candidate_summary(profile: CandidateProfile) -> CandidateSummary:
    return CandidateSummary(
        id=profile.id,
        full_name=profile.full_name,
        headline=profile.headline,
        summary=profile.summary,
        years_experience=profile.years_experience,
        location=profile.location,
        remote_preference=profile.remote_preference,
        skills=sorted(s.skill.name for s in profile.skills),
    )
