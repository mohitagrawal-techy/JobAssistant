import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.fx import SUPPORTED_CURRENCIES

Role = Literal["seeker", "recruiter"]
OrgType = Literal["company", "agency"]
RemotePreference = Literal["remote", "hybrid", "onsite", "any"]
LocationType = Literal["remote", "hybrid", "onsite"]
JobStatus = Literal["draft", "open", "closed"]
Stage = Literal["applied", "screening", "interview", "offer", "hired", "rejected"]
UtcOffset = Field(default=None, ge=-12, le=14)


def _check_currency(value: str) -> str:
    value = value.upper()
    if value not in SUPPORTED_CURRENCIES:
        raise ValueError(f"Currency must be one of {', '.join(SUPPORTED_CURRENCIES)}")
    return value


class GoogleSignupIn(BaseModel):
    role: Role
    consent: bool

    @field_validator("consent")
    @classmethod
    def consent_required(cls, value: bool) -> bool:
        if not value:
            raise ValueError("You must accept the privacy terms to register")
        return value


class RegisterIn(GoogleSignupIn):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=128)


class VerifyEmailIn(BaseModel):
    token: str = Field(max_length=200)


class OrgIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: OrgType


class OrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: OrgType


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    email_verified: bool
    full_name: str | None = None
    picture_url: str | None = None
    organization: OrgOut | None = None


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    years: float | None = Field(default=None, ge=0, le=60)


_PROFILE_DATE = r"^$|^\d{4}(-(0[1-9]|1[0-2]))?$"
JobType = Literal["full-time", "part-time", "contract", "internship"]
Availability = Literal[
    "", "immediately", "2-weeks", "1-month", "2-months", "3-months", "not-looking"
]


class DatedEntry(BaseModel):
    start: str = Field(default="", pattern=_PROFILE_DATE)
    end: str = Field(default="", pattern=_PROFILE_DATE)
    current: bool = False
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def end_after_start(self) -> "DatedEntry":
        if self.start and self.end and not self.current and self.end < self.start:
            raise ValueError("An end date can't be before its start date")
        return self


class WorkEntry(DatedEntry):
    title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)


class EducationEntry(BaseModel):
    degree: str = Field(default="", max_length=200)
    institution: str = Field(default="", max_length=200)
    year: int | None = Field(default=None, ge=1950, le=2100)


def _check_link(value: str) -> str:
    value = value.strip()
    # Links are shown to employers, so only web addresses are allowed (never javascript: etc).
    if value and not re.match(r"^https?://[^\s]+$", value, re.IGNORECASE):
        raise ValueError("Links must be full web addresses starting with https://")
    return value


class ProjectEntry(DatedEntry):
    name: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=300)
    technologies: list[Annotated[str, Field(max_length=100)]] = Field(
        default_factory=list, max_length=20
    )

    _url = field_validator("url")(_check_link)


class ProfileLinks(BaseModel):
    linkedin: str = Field(default="", max_length=300)
    github: str = Field(default="", max_length=300)
    portfolio: str = Field(default="", max_length=300)

    _links = field_validator("linkedin", "github", "portfolio")(_check_link)


class ProfileExtras(BaseModel):
    work_history: list[WorkEntry] = Field(default_factory=list, max_length=20)
    projects: list[ProjectEntry] = Field(default_factory=list, max_length=20)
    education: list[EducationEntry] = Field(default_factory=list, max_length=10)
    certifications: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=30
    )
    languages: list[Annotated[str, Field(max_length=100)]] = Field(
        default_factory=list, max_length=20
    )
    desired_roles: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=10
    )
    job_types: list[JobType] = Field(default_factory=list, max_length=4)
    links: ProfileLinks = Field(default_factory=ProfileLinks)
    availability: Availability = ""
    open_to_relocate: bool = False


class ProfileIn(ProfileExtras):
    full_name: str = Field(default="", max_length=200)
    headline: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=5000)
    years_experience: float | None = Field(default=None, ge=0, le=60)
    location: str = Field(default="", max_length=200)
    utc_offset: float | None = UtcOffset
    remote_preference: RemotePreference = "any"
    salary_min: int | None = Field(default=None, ge=0)
    currency: str = "USD"
    is_visible: bool = True
    skills: list[SkillIn] = Field(default_factory=list, max_length=100)

    _currency = field_validator("currency")(_check_currency)


class ProfileOut(ProfileIn):
    id: uuid.UUID
    has_embedding: bool


class ResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    parse_status: str
    parse_error: str | None
    extracted: dict | None
    created_at: datetime


class JobDraftIn(BaseModel):
    description: str = Field(min_length=20, max_length=30000)
    client_name: str | None = Field(default=None, max_length=200)


class JobIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=30000)
    client_name: str | None = Field(default=None, max_length=200)
    location_type: LocationType = "remote"
    location: str = Field(default="", max_length=200)
    tz_min: float | None = UtcOffset
    tz_max: float | None = UtcOffset
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    currency: str = "USD"
    min_years: float | None = Field(default=None, ge=0, le=60)
    required_skills: list[str] = Field(default_factory=list, max_length=50)
    nice_to_have_skills: list[str] = Field(default_factory=list, max_length=50)

    _currency = field_validator("currency")(_check_currency)


class JobStatusIn(BaseModel):
    status: JobStatus


class JobPublic(BaseModel):
    id: uuid.UUID
    organization_name: str
    title: str
    description: str
    location_type: LocationType
    location: str
    tz_min: float | None
    tz_max: float | None
    salary_min: int | None
    salary_max: int | None
    currency: str
    min_years: float | None
    required_skills: list[str]
    nice_to_have_skills: list[str]
    created_at: datetime


class JobOwner(JobPublic):
    client_name: str | None
    status: JobStatus
    parse_status: str
    parse_error: str | None


class JobListItem(JobOwner):
    applicant_count: int
    awaiting_review: int


class JobSearchOut(BaseModel):
    items: list[JobPublic]
    total: int


class ScoreOut(BaseModel):
    total: float
    skills: float
    semantic: float
    experience: float
    logistics: float
    matched_required: list[str]
    missing_required: list[str]
    matched_nice: list[str]
    missing_nice: list[str]


class CandidateSummary(ProfileExtras):
    id: uuid.UUID
    full_name: str
    headline: str
    summary: str
    years_experience: float | None
    location: str
    remote_preference: RemotePreference
    skills: list[str]


class CandidateMatch(BaseModel):
    candidate: CandidateSummary
    score: ScoreOut


class JobMatch(BaseModel):
    job: JobPublic
    score: ScoreOut
    applied: bool


class ExplanationPoint(BaseModel):
    skill: str
    reason: str


class ExplanationOut(BaseModel):
    strengths: list[ExplanationPoint]
    gaps: list[ExplanationPoint]
    summary: str
    source: Literal["ai", "template"]


class ApplicationIn(BaseModel):
    job_id: uuid.UUID


class ApplicationStageIn(BaseModel):
    stage: Stage


class SeekerApplication(BaseModel):
    id: uuid.UUID
    job: JobPublic
    stage: Stage
    created_at: datetime
    cover_note: str | None
    via_assistant: bool


class RecruiterApplication(BaseModel):
    id: uuid.UUID
    candidate: CandidateSummary
    stage: Stage
    created_at: datetime
    cover_note: str | None
    via_assistant: bool


class JobBrief(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    seniority: str = Field(default="", max_length=50)
    required_skills: list[str] = Field(default_factory=list, max_length=50)
    nice_to_have_skills: list[str] = Field(default_factory=list, max_length=50)
    location_type: LocationType = "remote"
    location: str = Field(default="", max_length=200)
    min_years: float | None = Field(default=None, ge=0, le=60)
    notes: str = Field(default="", max_length=2000)


class GenerateDescriptionIn(BaseModel):
    brief: JobBrief
    current_description: str | None = Field(default=None, max_length=30000)
    instruction: str | None = Field(default=None, max_length=500)


class CheckDescriptionIn(BaseModel):
    description: str = Field(max_length=30000)
    required_skills: list[str] = Field(default_factory=list, max_length=50)
    min_years: float | None = Field(default=None, ge=0, le=60)


class LanguageFlag(BaseModel):
    phrase: str
    suggestion: str


class DescriptionCheck(BaseModel):
    missing_skills: list[str]
    language_flags: list[LanguageFlag]


class GeneratedDescription(DescriptionCheck):
    title: str
    description: str


class ScoreBand(BaseModel):
    label: str
    count: int


class SkillCoverage(BaseModel):
    skill: str
    required: bool
    count: int
    percent: int


class ApplicantInsight(BaseModel):
    application_id: uuid.UUID
    candidate_id: uuid.UUID
    full_name: str
    headline: str
    stage: Stage
    days_waiting: int
    total: float
    skills: float
    semantic: float
    experience: float
    logistics: float


class JobAnalytics(BaseModel):
    applicant_count: int
    strong_count: int
    score_bands: list[ScoreBand]
    skill_coverage: list[SkillCoverage]
    top_candidates: list[ApplicantInsight]
    needs_decision: list[ApplicantInsight]


class AgentMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AgentIn(BaseModel):
    messages: list[AgentMessage] = Field(min_length=1, max_length=20)

    @field_validator("messages")
    @classmethod
    def ends_with_user(cls, value: list[AgentMessage]) -> list[AgentMessage]:
        if value[-1].role != "user":
            raise ValueError("The last message must be from the user")
        return value


class AgentCandidate(BaseModel):
    ref: str
    candidate: CandidateSummary
    score: ScoreOut
    application_id: uuid.UUID | None
    stage: Stage | None


AssistantMode = Literal["ask", "auto"]


class AssistantSettingsIn(BaseModel):
    enabled: bool
    mode: AssistantMode = "ask"
    min_score: int = Field(default=75, ge=50, le=100)
    daily_limit: int = Field(default=5, ge=1, le=10)
    require_all_skills: bool = False
    excluded_companies: list[str] = Field(default_factory=list, max_length=50)
    auto_consent: bool = False


class AssistantSettingsOut(BaseModel):
    enabled: bool
    mode: AssistantMode
    min_score: int
    daily_limit: int
    require_all_skills: bool
    excluded_companies: list[str]
    has_auto_consent: bool
    last_run_at: datetime | None


class AssistantActionOut(BaseModel):
    id: uuid.UUID
    job: JobPublic
    score: float
    note: str
    status: Literal["pending", "applied", "skipped", "withdrawn"]
    applied_automatically: bool
    created_at: datetime


class AssistantOut(BaseModel):
    settings: AssistantSettingsOut
    pending: list[AssistantActionOut]
    activity: list[AssistantActionOut]


class AssistantRunOut(BaseModel):
    applied: int
    suggested: int


class AssistantApproveIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)
