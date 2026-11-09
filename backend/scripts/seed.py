"""Load the committed fictional demo data. Safe to rerun, and needs no AI provider.

Usage: python -m scripts.seed
"""

import asyncio
import json
import random
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.db import SessionLocal
from app.fx import to_usd
from app.models import (
    Application,
    CandidateProfile,
    CandidateSkill,
    Job,
    JobSkill,
    Organization,
    OrgMember,
    User,
)
from app.skills import resolve_skills

DATA_FILE = Path(__file__).parent.parent / "seed" / "seed_data.json"
DEMO_SEEKER = "demo-seeker@example.com"
DEMO_RECRUITER = "demo-recruiter@example.com"
DEMO_PASSWORD = "demo-password"
DEMO_ORG = "Brightpath Talent"
SAME_FIELD_WEIGHT = 6


def _track(title: str) -> str:
    """The field of a seeded title, without its seniority prefix."""
    return re.sub(r"^(Junior|Senior|Staff) ", "", title)


def _stage_for_age(rng: random.Random, age_days: float) -> str:
    if age_days < 5:
        return rng.choices(["applied", "screening"], [85, 15])[0]
    return rng.choices(
        ["applied", "screening", "interview", "offer", "rejected"], [30, 25, 15, 5, 25]
    )[0]


async def seed(db: AsyncSession) -> None:
    if await db.scalar(select(User.id).where(User.email == DEMO_SEEKER)):
        print("Demo data is already loaded.")
        return

    data = json.loads(DATA_FILE.read_text())
    now = datetime.now(UTC)
    password_hash = hash_password(DEMO_PASSWORD)

    all_skills = {s for c in data["candidates"] for s in c["skills"]}
    all_skills |= {s for j in data["jobs"] for s in j["required"] + j["nice"]}
    skill_ids = await resolve_skills(db, sorted(all_skills))

    organizations = {
        name: Organization(name=name, type=org_type) for name, org_type in data["organizations"]
    }
    db.add_all(organizations.values())
    recruiter = User(
        email=DEMO_RECRUITER,
        password_hash=password_hash,
        role="recruiter",
        consent_at=now,
        email_verified_at=now,
    )
    db.add(recruiter)
    await db.flush()
    db.add(OrgMember(user_id=recruiter.id, org_id=organizations[DEMO_ORG].id))

    profiles: list[CandidateProfile] = []
    for item in data["candidates"]:
        user = User(
            email=item["email"],
            password_hash=password_hash,
            role="seeker",
            consent_at=now,
            email_verified_at=now,
        )
        db.add(user)
        await db.flush()
        profile = CandidateProfile(
            user_id=user.id,
            full_name=item["full_name"],
            headline=item["headline"],
            summary=item["summary"],
            years_experience=item["years_experience"],
            location=item["location"],
            utc_offset=item["utc_offset"],
            remote_preference=item["remote_preference"],
            salary_min=item["salary_min"],
            currency=item["currency"],
            salary_usd=to_usd(item["salary_min"], item["currency"]),
            embedding=item["embedding"],
            embedding_model=item["embedding_model"],
            skills=[CandidateSkill(skill_id=skill_ids[name]) for name in item["skills"]],
        )
        db.add(profile)
        profiles.append(profile)

    jobs: list[Job] = []
    for item in data["jobs"]:
        job = Job(
            org_id=organizations[item["org"]].id,
            client_name=item["client_name"],
            title=item["title"],
            description=item["description"],
            location_type=item["location_type"],
            location=item["location"],
            tz_min=item["tz_min"],
            tz_max=item["tz_max"],
            salary_min=item["salary_min"],
            salary_max=item["salary_max"],
            currency=item["currency"],
            salary_usd_min=to_usd(item["salary_min"], item["currency"]),
            salary_usd_max=to_usd(item["salary_max"], item["currency"]),
            min_years=item["min_years"],
            status="open",
            embedding=item["embedding"],
            embedding_model=item["embedding_model"],
            skills=[JobSkill(skill_id=skill_ids[name], required=True) for name in item["required"]]
            + [JobSkill(skill_id=skill_ids[name], required=False) for name in item["nice"]],
        )
        db.add(job)
        jobs.append(job)
    await db.flush()

    rng = random.Random(7)
    for job, item in zip(jobs, data["jobs"], strict=True):
        if item["org"] != DEMO_ORG:
            continue
        track = _track(item["title"])
        applicants = sorted(
            profiles[1:],
            key=lambda p: (
                rng.random() ** (1 / (SAME_FIELD_WEIGHT if _track(p.headline) == track else 1))
            ),
            reverse=True,
        )[: rng.randint(20, 40)]
        for profile in applicants:
            age_days = rng.uniform(0, 30)
            created = now - timedelta(days=age_days)
            stage = _stage_for_age(rng, age_days)
            moved_after = 0 if stage == "applied" else rng.uniform(0, age_days)
            db.add(
                Application(
                    candidate_id=profile.id,
                    job_id=job.id,
                    stage=stage,
                    created_at=created,
                    updated_at=created + timedelta(days=moved_after),
                )
            )

    await db.commit()
    print(
        f"Loaded {len(profiles)} candidates and {len(jobs)} jobs. "
        f"Log in as {DEMO_SEEKER} or {DEMO_RECRUITER} with password {DEMO_PASSWORD}."
    )


async def main() -> None:
    async with SessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
