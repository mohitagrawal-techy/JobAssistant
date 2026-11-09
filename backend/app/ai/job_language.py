"""Deterministic checks on job descriptions, so results are the same every time."""

import re

from app.schemas import DescriptionCheck, LanguageFlag
from app.skills import ALIASES, normalize_skill

# Wording research links to discouraging some groups from applying.
FLAGGED_PHRASES = {
    "rockstar": "skilled engineer",
    "rock star": "skilled engineer",
    "ninja": "expert",
    "guru": "specialist",
    "wizard": "specialist",
    "young": "remove any reference to age",
    "youthful": "remove any reference to age",
    "digital native": "comfortable with technology",
    "recent graduate": "early-career",
    "native speaker": "fluent in",
    "native english": "fluent in English",
    "manpower": "workforce",
    "salesman": "salesperson",
    "chairman": "chair",
    "he/she": "they",
    "able-bodied": "describe the physical tasks required",
    "culture fit": "shared values",
    "work hard, play hard": "describe the actual working pattern",
    "aggressive": "proactive",
}


def _contains(text: str, phrase: str) -> bool:
    return re.search(rf"(?<![\w]){re.escape(phrase)}(?![\w])", text) is not None


def language_flags(description: str) -> list[LanguageFlag]:
    lowered = description.lower()
    return [
        LanguageFlag(phrase=phrase, suggestion=suggestion)
        for phrase, suggestion in FLAGGED_PHRASES.items()
        if _contains(lowered, phrase)
    ]


def _accepted_names(skill: str) -> set[str]:
    canonical = normalize_skill(skill)
    return {skill.lower().strip(), canonical} | {
        alias for alias, target in ALIASES.items() if target == canonical
    }


def missing_skills(description: str, required_skills: list[str]) -> list[str]:
    lowered = description.lower()
    return [
        skill
        for skill in required_skills
        if not any(_contains(lowered, name) for name in _accepted_names(skill))
    ]


def unconfirmed_years(description: str, min_years: float | None) -> list[LanguageFlag]:
    """Flag experience figures that don't match what the recruiter entered."""
    flags = {}
    for match in re.finditer(
        r"(\d+(?:\.\d+)?)\s*\+?\s*(?:-\s*\d+\s*)?years?\b", description.lower()
    ):
        if min_years is None or float(match[1]) != min_years:
            flags[match[0]] = LanguageFlag(
                phrase=match[0], suggestion="confirm this or remove it, as it isn't in your brief"
            )
    return list(flags.values())


def check_description(
    description: str, required_skills: list[str], min_years: float | None = None
) -> DescriptionCheck:
    return DescriptionCheck(
        missing_skills=missing_skills(description, required_skills),
        language_flags=language_flags(description) + unconfirmed_years(description, min_years),
    )
