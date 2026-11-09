"""Deterministic stand-ins for tests and for running without Ollama."""

import hashlib
import json
import math
import re

from app.ai.base import ChatMessage, ChatReply, EmbeddingKind, T, ToolCall, ToolSpec
from app.ai.schemas import (
    CoverNote,
    ExplanationItem,
    JobDescriptionDraft,
    JobExtraction,
    MatchExplanation,
    ResumeExtraction,
)
from app.models import EMBEDDING_DIM

KNOWN_SKILLS = ["python", "react", "typescript", "postgresql", "docker", "aws", "go", "kubernetes"]


def _found_skills(text: str) -> list[str]:
    lowered = text.lower()
    return [skill for skill in KNOWN_SKILLS if re.search(rf"\b{re.escape(skill)}\b", lowered)]


class FakeClient:
    model = "fake"

    async def extract(self, system: str, text: str, schema: type[T]) -> T:
        first_line = next((line.strip() for line in text.splitlines() if line.strip()), "Unknown")
        if schema is ResumeExtraction:
            return schema(
                headline=first_line[:100],
                summary=text[:200],
                years_experience=5,
                location=None,
                skills=_found_skills(text),
            )
        if schema is JobExtraction:
            return schema(
                title=first_line[:100],
                required_skills=_found_skills(text),
                nice_to_have_skills=[],
                min_years=None,
                location_type="remote",
                location=None,
                salary_min=None,
                salary_max=None,
                currency=None,
            )
        if schema is MatchExplanation:
            facts = json.loads(text)
            return schema(
                strengths=[
                    ExplanationItem(skill=skill, reason="Listed on the profile.")
                    for skill in facts["matched_skills"]
                ],
                gaps=[
                    ExplanationItem(skill=skill, reason="Not listed on the profile.")
                    for skill in facts["missing_skills"]
                ],
                summary=f"Overall score {facts['total_score']}.",
            )
        if schema is JobDescriptionDraft:
            brief = json.loads(text)
            return schema(
                title=brief["title"],
                about_role=f"Join us as a {brief['title']} and help our customers succeed.",
                responsibilities=["Build features.", "Maintain systems.", "Support teammates."],
                requirements=brief["required_skills"] or ["Relevant experience"],
                nice_to_have=brief["nice_to_have_skills"],
            )
        if schema is CoverNote:
            facts = json.loads(text)
            return schema(
                note=f"I would like to apply for {facts['job_title']} with my background."
            )
        raise TypeError(f"FakeClient has no canned output for {schema.__name__}")

    async def chat(self, messages: list[ChatMessage], tools: list[ToolSpec]) -> ChatReply:
        """Call the first tool once, then name every candidate reference it returned."""
        last = messages[-1]
        if last.role == "tool":
            refs = list(dict.fromkeys(re.findall(r"C-[0-9a-f]{6}", last.content)))
            return ChatReply(text="Best matches: " + ", ".join(refs))
        if tools:
            return ChatReply(tool_calls=[ToolCall(name=tools[0].name, arguments={})])
        return ChatReply(text="Done.")


class FakeEmbeddingClient:
    model = "fake-embedding"

    async def embed(self, texts: list[str], kind: EmbeddingKind) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        vector = [0.0] * EMBEDDING_DIM
        for token in re.findall(r"\w+", text.lower()):
            digest = hashlib.sha256(token.encode()).digest()
            vector[int.from_bytes(digest[:4], "big") % EMBEDDING_DIM] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]
