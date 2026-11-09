"""Deterministic match scoring.

This module is pure: it sees only the structured features below. Names, contact details and
raw resume text are never inputs, so they cannot influence a score.
"""

from dataclasses import dataclass

import numpy as np

# nomic-embed-text scores unrelated roles around 0.65-0.75 and same-field roles around 0.83-0.88,
# so that band is mapped to 0..1. Recalibrate if EMBEDDING_MODEL changes.
SIMILARITY_FLOOR = 0.65
SIMILARITY_CEILING = 0.88
REQUIRED_SKILL_SHARE = 0.8
NEUTRAL = 0.5


@dataclass(frozen=True)
class Weights:
    skills: float = 50
    semantic: float = 25
    experience: float = 15
    logistics: float = 10

    def normalized(self) -> "Weights":
        total = self.skills + self.semantic + self.experience + self.logistics
        if total <= 0:
            return Weights()
        factor = 100 / total
        return Weights(
            self.skills * factor,
            self.semantic * factor,
            self.experience * factor,
            self.logistics * factor,
        )


@dataclass(frozen=True)
class CandidateFeatures:
    skills: frozenset[str]
    years_experience: float | None
    remote_preference: str
    utc_offset: float | None
    salary_usd: int | None
    embedding: tuple[float, ...] | None


@dataclass(frozen=True)
class JobFeatures:
    required_skills: frozenset[str]
    nice_skills: frozenset[str]
    min_years: float | None
    location_type: str
    tz_min: float | None
    tz_max: float | None
    salary_usd_max: int | None
    embedding: tuple[float, ...] | None


@dataclass(frozen=True)
class ScoreBreakdown:
    total: float
    skills: float
    semantic: float
    experience: float
    logistics: float
    matched_required: tuple[str, ...]
    missing_required: tuple[str, ...]
    matched_nice: tuple[str, ...]
    missing_nice: tuple[str, ...]


def _skills_ratio(candidate: CandidateFeatures, job: JobFeatures) -> float:
    if not job.required_skills and not job.nice_skills:
        return NEUTRAL
    required = (
        len(candidate.skills & job.required_skills) / len(job.required_skills)
        if job.required_skills
        else None
    )
    nice = (
        len(candidate.skills & job.nice_skills) / len(job.nice_skills) if job.nice_skills else None
    )
    if required is None:
        return nice  # type: ignore[return-value]
    if nice is None:
        return required
    return REQUIRED_SKILL_SHARE * required + (1 - REQUIRED_SKILL_SHARE) * nice


def _semantic_ratio(candidate: CandidateFeatures, job: JobFeatures) -> float:
    if candidate.embedding is None or job.embedding is None:
        return 0.0
    a, b = np.asarray(candidate.embedding), np.asarray(job.embedding)
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    if norm == 0:
        return 0.0
    similarity = float(np.dot(a, b)) / norm
    scaled = (similarity - SIMILARITY_FLOOR) / (SIMILARITY_CEILING - SIMILARITY_FLOOR)
    return min(1.0, max(0.0, scaled))


def _experience_ratio(candidate: CandidateFeatures, job: JobFeatures) -> float:
    if not job.min_years:
        return 1.0
    if candidate.years_experience is None:
        return NEUTRAL
    return min(1.0, candidate.years_experience / job.min_years)


def _logistics_ratio(candidate: CandidateFeatures, job: JobFeatures) -> float:
    work_mode = 1.0 if candidate.remote_preference == job.location_type else 0.7
    in_window = (
        job.tz_min is None
        or job.tz_max is None
        or candidate.utc_offset is None
        or job.tz_min <= candidate.utc_offset <= job.tz_max
    )
    affordable = (
        job.salary_usd_max is None
        or candidate.salary_usd is None
        or candidate.salary_usd <= job.salary_usd_max
    )
    return work_mode * 0.5 + (0.25 if in_window else 0) + (0.25 if affordable else 0)


def score_match(
    candidate: CandidateFeatures, job: JobFeatures, weights: Weights = Weights()
) -> ScoreBreakdown:
    w = weights.normalized()
    skills = _skills_ratio(candidate, job) * w.skills
    semantic = _semantic_ratio(candidate, job) * w.semantic
    experience = _experience_ratio(candidate, job) * w.experience
    logistics = _logistics_ratio(candidate, job) * w.logistics
    return ScoreBreakdown(
        total=round(skills + semantic + experience + logistics, 1),
        skills=round(skills, 1),
        semantic=round(semantic, 1),
        experience=round(experience, 1),
        logistics=round(logistics, 1),
        matched_required=tuple(sorted(candidate.skills & job.required_skills)),
        missing_required=tuple(sorted(job.required_skills - candidate.skills)),
        matched_nice=tuple(sorted(candidate.skills & job.nice_skills)),
        missing_nice=tuple(sorted(job.nice_skills - candidate.skills)),
    )
