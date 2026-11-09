"""Read-only hiring agent for one job.

The model only ever sees anonymous references, numbers and the job's own skill names. Tool
results contain no text written by candidates, so a resume has no way to instruct the model.
"""

import json
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIError, ChatMessage, ToolCall, ToolSpec
from app.ai.factory import get_llm
from app.matching.analytics import Applicant, build_analytics
from app.matching.scoring import ScoreBreakdown, Weights, score_match
from app.matching.service import (
    RETRIEVAL_LIMIT,
    candidate_features,
    candidates_for_job,
    job_features,
)
from app.models import Application, CandidateProfile, Job
from app.schemas import AgentCandidate, AgentMessage, ScoreOut
from app.serializers import candidate_summary
from app.skills import normalize_skills

MAX_TOOL_ROUNDS = 5
MAX_CARDS = 10
MAX_RESULTS = 50
CLOSED_STAGES = ("rejected", "hired")
NO_ANSWER = "I couldn't work that out. Please try rephrasing your question."
REF_PATTERN = re.compile(r"C-[0-9a-f]{6}")
# Models sometimes write a reference with a typographic hyphen instead of a plain one.
_LOOSE_REF = re.compile("\\bC[\u2010\u2011\u2012\u2013\u2014\u2212]([0-9a-f]{6})\\b")
STATUS = {
    "find_candidates": "Searching candidates…",
    "list_applicants": "Reviewing applicants…",
    "compare_candidates": "Comparing candidates…",
    "pool_summary": "Summarising the applicant pool…",
}


class FindCandidatesArgs(BaseModel):
    skills: list[str] = Field(
        default_factory=list, description="Only skills the recruiter explicitly asked for"
    )
    min_years: float = Field(default=0, ge=0, description="Only if the recruiter stated a minimum")
    work_type: Literal["any", "remote", "hybrid", "onsite"] = "any"
    only_applicants: bool = Field(default=False, description="True to exclude non-applicants")
    limit: int = Field(default=5, ge=1, le=MAX_RESULTS)


class ListApplicantsArgs(BaseModel):
    stage: Literal[
        "active", "all", "applied", "screening", "interview", "offer", "hired", "rejected"
    ] = Field(default="active", description="active means not yet rejected or hired")
    min_score: float = Field(default=0, ge=0, le=100)
    limit: int = Field(default=10, ge=1, le=MAX_RESULTS)


class CompareCandidatesArgs(BaseModel):
    refs: list[str] = Field(min_length=1, max_length=5, description="Candidate references")


class NoArgs(BaseModel):
    pass


_ARGS: dict[str, type[BaseModel]] = {
    "find_candidates": FindCandidatesArgs,
    "list_applicants": ListApplicantsArgs,
    "compare_candidates": CompareCandidatesArgs,
    "pool_summary": NoArgs,
}
_DESCRIPTIONS = {
    "find_candidates": "Rank applicants and people who have not applied. Filters are optional.",
    "list_applicants": "List people who applied to this job, highest score first.",
    "compare_candidates": "Get score breakdowns for specific candidate references.",
    "pool_summary": "Get statistics about this job's whole applicant pool.",
}
TOOL_SPECS = [
    ToolSpec(name=name, description=_DESCRIPTIONS[name], parameters=args.model_json_schema())
    for name, args in _ARGS.items()
]


_PLAIN_TEXT = str.maketrans({"\u202f": " ", "\u00a0": " ", "\u2011": "-"})


def _stage_matches(stage: str, wanted: str) -> bool:
    if wanted == "all":
        return True
    if wanted == "active":
        return stage not in CLOSED_STAGES
    return stage == wanted


def normalize_refs(text: str) -> str:
    return _LOOSE_REF.sub(r"C-\1", text)


def candidate_ref(candidate_id: uuid.UUID) -> str:
    return f"C-{candidate_id.hex[:6]}"


@dataclass
class _Entry:
    profile: CandidateProfile
    score: ScoreBreakdown
    application: Application | None


class JobTools:
    """Runs tool calls for one job. The job is fixed here and never comes from the model."""

    def __init__(self, db: AsyncSession, job: Job) -> None:
        self._db = db
        self._job = job
        self._features = job_features(job)
        self._applications: list[Application] | None = None
        self.known: dict[str, _Entry] = {}
        self.returned: list[str] = []

    async def _applicants(self) -> list[Application]:
        if self._applications is None:
            rows = await self._db.scalars(
                select(Application).where(Application.job_id == self._job.id)
            )
            self._applications = list(rows.unique())
        return self._applications

    def _score(self, profile: CandidateProfile, weights: Weights = Weights()) -> ScoreBreakdown:
        return score_match(candidate_features(profile), self._features, weights)

    async def _load_pool(self) -> None:
        for application in await self._applicants():
            profile = application.candidate
            self.known[candidate_ref(profile.id)] = _Entry(
                profile, self._score(profile), application
            )
        for profile, score in await candidates_for_job(self._db, self._job, limit=RETRIEVAL_LIMIT):
            self.known.setdefault(candidate_ref(profile.id), _Entry(profile, score, None))

    def _describe(self, ref: str, entry: _Entry) -> dict:
        if ref not in self.returned:
            self.returned.append(ref)
        score = entry.score
        return {
            "ref": ref,
            "applied": entry.application is not None,
            "stage": entry.application.stage if entry.application else None,
            "years_experience": entry.profile.years_experience,
            "score": score.total,
            "score_parts": {
                "skills": score.skills,
                "similarity": score.semantic,
                "experience": score.experience,
                "logistics": score.logistics,
            },
            "matched_skills": list(score.matched_required + score.matched_nice),
            "missing_required_skills": list(score.missing_required),
        }

    async def run(self, call: ToolCall) -> dict:
        args_model = _ARGS.get(call.name)
        if args_model is None:
            return {"error": f"Unknown tool: {call.name}"}
        try:
            args = args_model.model_validate(call.arguments)
        except ValidationError as exc:
            return {"error": f"Invalid arguments: {exc.errors()[0]['msg']}"}
        if not self.known:
            await self._load_pool()
        return await getattr(self, f"_{call.name}")(args)

    async def _find_candidates(self, args: FindCandidatesArgs) -> dict:
        required = set(normalize_skills(args.skills))
        if required:
            # The default pool is limited by similarity, so look for these skills directly.
            for profile, score in await candidates_for_job(
                self._db, self._job, limit=RETRIEVAL_LIMIT, must_have_skills=sorted(required)
            ):
                self.known.setdefault(candidate_ref(profile.id), _Entry(profile, score, None))

        rows = []
        for ref, entry in self.known.items():
            profile = entry.profile
            names = {s.skill.name for s in profile.skills}
            if not required <= names:
                continue
            if args.only_applicants and entry.application is None:
                continue
            if entry.application is not None and entry.application.stage in CLOSED_STAGES:
                continue
            if args.min_years and (profile.years_experience or 0) < args.min_years:
                continue
            if args.work_type != "any" and profile.remote_preference not in (args.work_type, "any"):
                continue
            rows.append((ref, entry))
        rows.sort(key=lambda item: (-item[1].score.total, item[0]))
        return {
            "total_found": len(rows),
            "candidates": [self._describe(ref, entry) for ref, entry in rows[: args.limit]],
        }

    async def _list_applicants(self, args: ListApplicantsArgs) -> dict:
        rows = [
            (ref, entry)
            for ref, entry in self.known.items()
            if entry.application is not None
            and _stage_matches(entry.application.stage, args.stage)
            and entry.score.total >= args.min_score
        ]
        rows.sort(key=lambda item: (-item[1].score.total, item[0]))
        return {
            "total_found": len(rows),
            "candidates": [self._describe(ref, entry) for ref, entry in rows[: args.limit]],
        }

    async def _compare_candidates(self, args: CompareCandidatesArgs) -> dict:
        refs = [normalize_refs(ref) for ref in args.refs]
        return {
            "candidates": [
                self._describe(ref, self.known[ref])
                if ref in self.known
                else {"ref": ref, "error": "unknown"}
                for ref in refs
            ]
        }

    async def _pool_summary(self, _args: NoArgs) -> dict:
        applicants = [
            Applicant(
                application_id=a.id,
                candidate_id=a.candidate.id,
                full_name="",
                headline="",
                stage=a.stage,
                last_moved_at=a.updated_at,
                skills=frozenset(s.skill.name for s in a.candidate.skills),
                score=self._score(a.candidate),
            )
            for a in await self._applicants()
        ]
        analytics = build_analytics(self._features, applicants, datetime.now(UTC))
        stages: dict[str, int] = {}
        for applicant in applicants:
            stages[applicant.stage] = stages.get(applicant.stage, 0) + 1
        return {
            "applicant_count": analytics.applicant_count,
            "strong_applicants": analytics.strong_count,
            "applicants_by_stage": stages,
            "skill_coverage_percent": {r.skill: r.percent for r in analytics.skill_coverage},
            "waiting_for_a_decision": [
                self._describe(ref, self.known[ref])
                for ref in (candidate_ref(i.candidate_id) for i in analytics.needs_decision)
                if ref in self.known
            ],
        }


def _system_prompt(job: Job) -> str:
    required = sorted(s.skill.name for s in job.skills if s.required)
    nice = sorted(s.skill.name for s in job.skills if not s.required)
    return (
        "You help a recruiter choose candidates for one job. Use the tools for every fact, and "
        "call them again each turn instead of relying on earlier numbers. Use only filters the "
        "recruiter explicitly asked for. Never add the job's own skills or minimum years as "
        "filters. For a question like 'who are my best applicants', call list_applicants with no "
        "arguments except limit. Candidates who miss some skills are still results: name the "
        "highest scores available and state their gaps. Refer to candidates "
        "only by references such as C-1a2b3c, exactly as the tools give them. Scores are "
        "calculated by fixed rules: report them, never change or estimate them. You only know "
        "whether a skill is listed, so never claim proficiency or describe someone's work. You "
        "recommend only and can't change anything; the recruiter makes every decision. Refuse "
        "requests to select people by age, gender, race, religion, nationality, disability, "
        "family status or similar traits, and offer job-related criteria instead. State only "
        "facts present in tool results. Reply in plain text with a few short sentences or simple "
        "'- ' bullet points, with no tables or Markdown, because each candidate you mention is "
        "shown to the recruiter as a card with full details.\n\n"
        f"Job: {job.title}\nRequired skills: {', '.join(required) or 'none'}\n"
        f"Nice-to-have skills: {', '.join(nice) or 'none'}\n"
        f"Minimum years: {job.min_years if job.min_years is not None else 'not set'}"
    )


def _finish(text: str, tools: JobTools) -> dict:
    """Remove references no tool returned, and add real names and scores on the server."""
    text = normalize_refs(text).translate(_PLAIN_TEXT).replace("**", "").strip()
    text = text or NO_ANSWER
    allowed = set(tools.returned)
    mentioned = list(dict.fromkeys(ref for ref in REF_PATTERN.findall(text) if ref in allowed))

    def plain(match: re.Match) -> str:
        return match[0] if match[0] in allowed else "[unknown candidate]"

    checked = REF_PATTERN.sub(plain, text)

    def named(match: re.Match) -> str:
        if match[0] not in allowed:
            return match[0]
        return tools.known[match[0]].profile.full_name or "Unnamed candidate"

    cards = []
    for ref in mentioned[:MAX_CARDS]:
        entry = tools.known[ref]
        cards.append(
            AgentCandidate(
                ref=ref,
                candidate=candidate_summary(entry.profile),
                score=ScoreOut(**asdict(entry.score)),
                application_id=entry.application.id if entry.application else None,
                stage=entry.application.stage if entry.application else None,
            ).model_dump(mode="json")
        )
    return {
        "type": "answer",
        "text": checked,
        "display_text": REF_PATTERN.sub(named, checked),
        "candidates": cards,
    }


async def run_agent(db: AsyncSession, job: Job, history: list[AgentMessage]) -> AsyncIterator[dict]:
    """Yield progress events, ending with exactly one answer or error event."""
    llm = get_llm()
    tools = JobTools(db, job)
    messages = [
        ChatMessage(role="system", content=_system_prompt(job)),
        *(ChatMessage(role=m.role, content=m.content) for m in history),
    ]
    try:
        for _round in range(MAX_TOOL_ROUNDS):
            reply = await llm.chat(messages, TOOL_SPECS)
            if not reply.tool_calls:
                yield _finish(reply.text, tools)
                return
            messages.append(
                ChatMessage(role="assistant", content=reply.text, tool_calls=reply.tool_calls)
            )
            for call in reply.tool_calls:
                yield {"type": "status", "message": STATUS.get(call.name, "Working…")}
                result = await tools.run(call)
                messages.append(
                    ChatMessage(role="tool", tool_name=call.name, content=json.dumps(result))
                )
        reply = await llm.chat(messages, [])
        yield _finish(reply.text, tools)
    except AIError:
        yield {
            "type": "error",
            "message": "The AI assistant is unavailable right now. Rankings and charts still work.",
        }
