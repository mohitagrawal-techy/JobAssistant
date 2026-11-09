"""Maps free-text skill names to one canonical name, so "ReactJS" matches "react"."""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Skill

ALIASES = {
    "amazon web services": "aws",
    "c sharp": "c#",
    "golang": "go",
    "google cloud": "gcp",
    "google cloud platform": "gcp",
    "js": "javascript",
    "k8s": "kubernetes",
    "ml": "machine learning",
    "next": "next.js",
    "nextjs": "next.js",
    "node": "node.js",
    "nodejs": "node.js",
    "postgres": "postgresql",
    "py": "python",
    "react.js": "react",
    "reactjs": "react",
    "ts": "typescript",
    "vue.js": "vue",
    "vuejs": "vue",
}


def normalize_skill(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", name).strip().lower()[:100]
    return ALIASES.get(cleaned, cleaned)


def normalize_skills(names: list[str]) -> list[str]:
    """Normalized names with blanks and duplicates removed, keeping first-seen order."""
    return list(dict.fromkeys(n for n in map(normalize_skill, names) if n))


async def resolve_skills(db: AsyncSession, names: list[str]) -> dict[str, uuid.UUID]:
    """Return {canonical name: skill id}, creating any skills that don't exist yet."""
    canonical = normalize_skills(names)
    if not canonical:
        return {}
    await db.execute(
        insert(Skill)
        .values([{"id": uuid.uuid4(), "name": name} for name in canonical])
        .on_conflict_do_nothing(index_elements=["name"])
    )
    rows = await db.execute(select(Skill.name, Skill.id).where(Skill.name.in_(canonical)))
    return {name: skill_id for name, skill_id in rows}
