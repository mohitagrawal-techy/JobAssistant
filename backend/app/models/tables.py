import uuid
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

EMBEDDING_DIM = 768


def _now() -> datetime:
    return datetime.now(UTC)


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=_now, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))  # seeker | recruiter
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20))  # company | agency
    created_at: Mapped[datetime] = _created()


class OrgMember(Base):
    __tablename__ = "org_members"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )

    organization: Mapped[Organization] = relationship()


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"

    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    full_name: Mapped[str] = mapped_column(String(200), default="")
    headline: Mapped[str] = mapped_column(String(200), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    years_experience: Mapped[float | None] = mapped_column(Float)
    location: Mapped[str] = mapped_column(String(200), default="")
    utc_offset: Mapped[float | None] = mapped_column(Float)
    remote_preference: Mapped[str] = mapped_column(String(20), default="any")
    salary_min: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    salary_usd: Mapped[int | None] = mapped_column(Integer)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(String(100))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, server_default=func.now()
    )

    skills: Mapped[list["CandidateSkill"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class CandidateSkill(Base):
    __tablename__ = "candidate_skills"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True
    )
    years: Mapped[float | None] = mapped_column(Float)

    skill: Mapped[Skill] = relationship(lazy="joined")


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = _id()
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True
    )
    file_path: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(255))
    parse_status: Mapped[str] = mapped_column(String(20), default="pending")
    parse_error: Mapped[str | None] = mapped_column(String(500))
    extracted: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = _created()


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = _id()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    client_name: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text)
    location_type: Mapped[str] = mapped_column(String(20), default="remote")
    location: Mapped[str] = mapped_column(String(200), default="")
    tz_min: Mapped[float | None] = mapped_column(Float)
    tz_max: Mapped[float | None] = mapped_column(Float)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    salary_usd_min: Mapped[int | None] = mapped_column(Integer)
    salary_usd_max: Mapped[int | None] = mapped_column(Integer)
    min_years: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    parse_status: Mapped[str] = mapped_column(String(20), default="none")
    parse_error: Mapped[str | None] = mapped_column(String(500))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = _created()

    organization: Mapped[Organization] = relationship(lazy="joined")
    skills: Mapped[list["JobSkill"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class JobSkill(Base):
    __tablename__ = "job_skills"

    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True
    )
    required: Mapped[bool] = mapped_column(Boolean, default=True)

    skill: Mapped[Skill] = relationship(lazy="joined")


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("candidate_id", "job_id"),)

    id: Mapped[uuid.UUID] = _id()
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(20), default="applied")
    cover_note: Mapped[str | None] = mapped_column(Text)
    via_assistant: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, server_default=func.now()
    )

    candidate: Mapped[CandidateProfile] = relationship(lazy="joined")
    job: Mapped[Job] = relationship(lazy="joined")


class AssistantSettings(Base):
    __tablename__ = "assistant_settings"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(10), default="ask")  # ask | auto
    min_score: Mapped[int] = mapped_column(Integer, default=75)
    daily_limit: Mapped[int] = mapped_column(Integer, default=5)
    require_all_skills: Mapped[bool] = mapped_column(Boolean, default=False)
    excluded_companies: Mapped[list] = mapped_column(JSON, default=list)
    auto_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssistantAction(Base):
    __tablename__ = "assistant_actions"
    __table_args__ = (UniqueConstraint("candidate_id", "job_id"),)

    id: Mapped[uuid.UUID] = _id()
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    score: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20))  # pending | applied | skipped | withdrawn
    applied_automatically: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()

    job: Mapped[Job] = relationship(lazy="joined")


class MatchExplanationRecord(Base):
    __tablename__ = "match_explanations"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidate_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    input_hash: Mapped[str] = mapped_column(String(64))
    strengths: Mapped[list] = mapped_column(JSON)
    gaps: Mapped[list] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
