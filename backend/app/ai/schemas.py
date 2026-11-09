from typing import Literal

from pydantic import BaseModel, Field


class WorkEntryExtraction(BaseModel):
    title: str
    company: str
    start: str | None = Field(default=None, description="YYYY or YYYY-MM")
    end: str | None = Field(default=None, description="YYYY or YYYY-MM; null if current")
    current: bool = False
    description: str = Field(default="", description="One or two sentences, from the resume only")


class ProjectExtraction(BaseModel):
    name: str
    role: str = ""
    start: str | None = Field(default=None, description="YYYY or YYYY-MM")
    end: str | None = Field(default=None, description="YYYY or YYYY-MM; null if ongoing")
    current: bool = False
    description: str = Field(default="", description="One or two sentences, from the resume only")
    url: str | None = None
    technologies: list[str] = Field(default_factory=list)


class EducationExtraction(BaseModel):
    degree: str
    institution: str
    year: int | None = Field(default=None, description="Graduation year")


class ResumeExtraction(BaseModel):
    headline: str = Field(description="Current or most recent job title, or a short role summary")
    summary: str = Field(description="Two or three sentence professional summary")
    years_experience: float | None = Field(description="Total years of professional experience")
    location: str | None = Field(description="City and country, if stated")
    skills: list[str] = Field(description="Technical and professional skills, as short names")
    work_history: list[WorkEntryExtraction] = Field(default_factory=list)
    projects: list[ProjectExtraction] = Field(
        default_factory=list, description="Personal or professional projects listed in the resume"
    )
    education: list[EducationExtraction] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list, description="Spoken languages only")


class JobExtraction(BaseModel):
    title: str = Field(description="The job title")
    required_skills: list[str] = Field(description="Skills the job says are required")
    nice_to_have_skills: list[str] = Field(description="Skills described as optional or a plus")
    min_years: float | None = Field(description="Minimum years of experience, if stated")
    location_type: Literal["remote", "hybrid", "onsite"] | None
    location: str | None = Field(description="Office location or eligible region, if stated")
    salary_min: int | None = Field(description="Minimum annual salary, if stated")
    salary_max: int | None = Field(description="Maximum annual salary, if stated")
    currency: str | None = Field(description="Three-letter ISO currency code of the salary")


class ExplanationItem(BaseModel):
    skill: str
    reason: str = Field(description="One short sentence")


class MatchExplanation(BaseModel):
    strengths: list[ExplanationItem]
    gaps: list[ExplanationItem]
    summary: str = Field(description="Two sentences on overall fit")


class JobDescriptionDraft(BaseModel):
    title: str
    about_role: str = Field(min_length=40, description="Two or three sentences about the role")
    responsibilities: list[str] = Field(
        min_length=3, max_length=8, description="Typical duties, as full sentences"
    )
    requirements: list[str] = Field(
        min_length=1, description="Must name every required skill from the brief"
    )
    nice_to_have: list[str] = Field(description="Only the brief's nice-to-have skills")


class CoverNote(BaseModel):
    note: str = Field(min_length=40, max_length=900, description="Two to four sentences")
