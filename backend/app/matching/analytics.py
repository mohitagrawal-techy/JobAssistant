"""Charts data for one job's applicants. Pure functions, with no AI involved."""

from dataclasses import dataclass
from datetime import datetime

from app.matching.scoring import JobFeatures, ScoreBreakdown
from app.schemas import ApplicantInsight, JobAnalytics, ScoreBand, SkillCoverage

STRONG_SCORE = 60
TOP_COUNT = 5
NEEDS_DECISION_COUNT = 8
_CLOSED_STAGES = {"rejected", "hired"}
_DECISION_STAGES = {"applied", "screening"}


@dataclass(frozen=True)
class Applicant:
    application_id: object
    candidate_id: object
    full_name: str
    headline: str
    stage: str
    last_moved_at: datetime
    skills: frozenset[str]
    score: ScoreBreakdown


def _insight(applicant: Applicant, now: datetime) -> ApplicantInsight:
    return ApplicantInsight(
        application_id=applicant.application_id,
        candidate_id=applicant.candidate_id,
        full_name=applicant.full_name,
        headline=applicant.headline,
        stage=applicant.stage,
        days_waiting=max(0, (now - applicant.last_moved_at).days),
        total=applicant.score.total,
        skills=applicant.score.skills,
        semantic=applicant.score.semantic,
        experience=applicant.score.experience,
        logistics=applicant.score.logistics,
    )


def score_bands(applicants: list[Applicant]) -> list[ScoreBand]:
    counts = [0] * 10
    for applicant in applicants:
        counts[min(int(applicant.score.total // 10), 9)] += 1
    labels = [f"{low}-{low + 9}" for low in range(0, 90, 10)] + ["90-100"]
    return [
        ScoreBand(label=label, count=count) for label, count in zip(labels, counts, strict=True)
    ]


def skill_coverage(job: JobFeatures, applicants: list[Applicant]) -> list[SkillCoverage]:
    """Required skills first, and within each group the biggest shortage first."""
    rows = []
    for skill, required in [(s, True) for s in job.required_skills] + [
        (s, False) for s in job.nice_skills
    ]:
        count = sum(skill in applicant.skills for applicant in applicants)
        percent = round(100 * count / len(applicants)) if applicants else 0
        rows.append(SkillCoverage(skill=skill, required=required, count=count, percent=percent))
    return sorted(rows, key=lambda row: (not row.required, row.percent, row.skill))


def build_analytics(job: JobFeatures, applicants: list[Applicant], now: datetime) -> JobAnalytics:
    by_score = sorted(applicants, key=lambda a: (-a.score.total, str(a.candidate_id)))
    active = [a for a in by_score if a.stage not in _CLOSED_STAGES]
    waiting = [a for a in by_score if a.stage in _DECISION_STAGES and a.score.total >= STRONG_SCORE]
    # by_score is sorted, so equally long waits keep the stronger applicant first.
    waiting.sort(key=lambda a: a.last_moved_at)
    return JobAnalytics(
        applicant_count=len(applicants),
        strong_count=sum(a.score.total >= STRONG_SCORE for a in applicants),
        score_bands=score_bands(applicants),
        skill_coverage=skill_coverage(job, applicants),
        top_candidates=[_insight(a, now) for a in active[:TOP_COUNT]],
        needs_decision=[_insight(a, now) for a in waiting[:NEEDS_DECISION_COUNT]],
    )
