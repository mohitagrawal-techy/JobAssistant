"""Generate fictional demo data with real embeddings into seed/seed_data.json.

Needs Ollama. Only rerun to change the demo data: the output is committed, so seeding doesn't.
Usage: python -m scripts.generate_seed
"""

import asyncio
import json
import random
from pathlib import Path
from types import SimpleNamespace

from app.ai.ollama_client import OllamaEmbeddingClient
from app.ai.tasks import candidate_embedding_text, job_embedding_text
from app.config import get_settings

OUTPUT = Path(__file__).parent.parent / "seed" / "seed_data.json"
CANDIDATE_COUNT = 200
JOB_COUNT = 100
BATCH_SIZE = 32

FIRST = (
    "Maya Jordan Aisha Alex Priya Liam Sofia Kenji Amara Noah Elena Ravi Zoe Mateo Hana "
    "Omar Ingrid Tariq Lucia Wei Nadia Felix Chiara Dev Yara Hugo Mei Samir Anya Kofi"
).split()
LAST = (
    "Chen Okafor Rahman Novak Sharma Murphy Rossi Tanaka Mensah Fischer Petrova Iyer Clarke "
    "Garcia Kim Haddad Larsen Aziz Moreno Zhang Popescu Weber Conti Mehta Nasser Silva Lin"
).split()
LOCATIONS = [
    ("Berlin, Germany", 1, "EUR", 1.0),
    ("London, UK", 0, "GBP", 0.85),
    ("Bengaluru, India", 5.5, "INR", 28.0),
    ("Toronto, Canada", -5, "CAD", 1.2),
    ("New York, USA", -5, "USD", 1.15),
    ("San Francisco, USA", -8, "USD", 1.3),
    ("Singapore", 8, "SGD", 1.25),
    ("Sydney, Australia", 10, "AUD", 1.3),
    ("Dubai, UAE", 4, "AED", 3.6),
    ("Lisbon, Portugal", 0, "EUR", 0.7),
]
TRACKS = {
    "Backend Engineer": ["python", "go", "postgresql", "redis", "docker", "kubernetes", "aws", "fastapi", "kafka", "graphql"],
    "Frontend Engineer": ["react", "typescript", "javascript", "next.js", "tailwind css", "graphql", "cypress", "vue", "figma"],
    "Full Stack Developer": ["react", "typescript", "node.js", "postgresql", "docker", "aws", "next.js", "graphql", "redis"],
    "Data Scientist": ["python", "sql", "pandas", "scikit-learn", "pytorch", "machine learning", "statistics", "airflow"],
    "Data Engineer": ["python", "sql", "spark", "airflow", "kafka", "dbt", "snowflake", "aws", "docker"],
    "DevOps Engineer": ["kubernetes", "docker", "terraform", "aws", "gcp", "linux", "ci/cd", "prometheus", "python"],
    "Mobile Developer": ["swift", "kotlin", "react native", "ios", "android", "firebase", "typescript"],
    "Product Designer": ["figma", "user research", "prototyping", "design systems", "accessibility", "usability testing"],
    "Product Manager": ["roadmapping", "user research", "sql", "stakeholder management", "agile", "analytics"],
}  # fmt: skip
ORGANIZATIONS = [
    ("Northwind Labs", "company"),
    ("Brightpath Talent", "agency"),
    ("Finlytic", "company"),
    ("Orbit Recruiting", "agency"),
    ("Kestrel Health", "company"),
    ("Lumen Commerce", "company"),
]
SENIORITY = [("Junior", 1, 3), ("", 3, 6), ("Senior", 6, 10), ("Staff", 10, 15)]
BASE_SALARY_USD = {"Junior": 45000, "": 75000, "Senior": 110000, "Staff": 150000}


def _embeddable(item: dict, kind: str) -> SimpleNamespace:
    skills = item["skills"] if kind == "candidate" else item["required"] + item["nice"]
    return SimpleNamespace(
        headline=item.get("headline", ""),
        title=item.get("title", ""),
        summary=item.get("summary", ""),
        description=item.get("description", ""),
        skills=[SimpleNamespace(skill=SimpleNamespace(name=name)) for name in skills],
    )


def make_candidate(rng: random.Random, index: int) -> dict:
    track, pool = rng.choice(list(TRACKS.items()))
    level, low, high = rng.choice(SENIORITY)
    location, offset, currency, factor = rng.choice(LOCATIONS)
    skills = rng.sample(pool, k=min(len(pool), rng.randint(4, 8)))
    years = rng.randint(low, high)
    title = f"{level} {track}".strip()
    salary = BASE_SALARY_USD[level] * rng.uniform(0.85, 1.15) * factor
    return {
        "email": f"candidate{index}@example.com",
        "full_name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
        "headline": title,
        "summary": (
            f"{title} with {years} years of experience, working mainly with "
            f"{', '.join(skills[:3])}. Enjoys shipping reliable products with small teams."
        ),
        "years_experience": years,
        "location": location,
        "utc_offset": offset,
        "remote_preference": rng.choice(["remote", "remote", "hybrid", "any", "onsite"]),
        "salary_min": int(round(salary, -3)),
        "currency": currency,
        "skills": skills,
    }


def make_job(rng: random.Random) -> dict:
    track, pool = rng.choice(list(TRACKS.items()))
    level, low, _high = rng.choice(SENIORITY)
    org_name, org_type = rng.choice(ORGANIZATIONS)
    location, offset, currency, factor = rng.choice(LOCATIONS)
    shuffled = rng.sample(pool, k=len(pool))
    required = shuffled[: rng.randint(3, 5)]
    nice = shuffled[len(required) : len(required) + rng.randint(1, 3)]
    title = f"{level} {track}".strip()
    location_type = rng.choice(["remote", "remote", "hybrid", "onsite"])
    salary = BASE_SALARY_USD[level] * rng.uniform(0.9, 1.1) * factor
    has_window = location_type == "remote" and rng.random() < 0.4
    return {
        "org": org_name,
        "org_type": org_type,
        "client_name": f"Client {rng.randint(100, 999)}" if org_type == "agency" else None,
        "title": title,
        "description": (
            f"We're hiring a {title} to join a product team at {org_name}.\n\n"
            f"You'll work with {', '.join(required)} to design, build and maintain features "
            f"used every day by our customers.\n\n"
            f"Requirements: at least {low} years of relevant experience and solid "
            f"{', '.join(required)}.\nNice to have: {', '.join(nice) or 'curiosity'}."
        ),
        "location_type": location_type,
        "location": "Remote" if location_type == "remote" else location,
        "tz_min": offset - 4 if has_window else None,
        "tz_max": offset + 4 if has_window else None,
        "salary_min": int(round(salary, -3)),
        "salary_max": int(round(salary * 1.3, -3)),
        "currency": currency,
        "min_years": low,
        "required": required,
        "nice": nice,
    }


async def embed_all(items: list[dict], texts: list[str], kind: str) -> None:
    settings = get_settings()
    embedder = OllamaEmbeddingClient(settings.embedding_model, settings.embedding_base_url)
    for start in range(0, len(items), BATCH_SIZE):
        vectors = await embedder.embed(texts[start : start + BATCH_SIZE], kind)
        for item, vector in zip(items[start : start + BATCH_SIZE], vectors, strict=True):
            item["embedding"] = [round(value, 4) for value in vector]
            item["embedding_model"] = embedder.model


async def main() -> None:
    rng = random.Random(42)
    candidates = [make_candidate(rng, index) for index in range(CANDIDATE_COUNT)]
    candidates[0] = {
        **candidates[0],
        "email": "demo-seeker@example.com",
        "full_name": "Demo Seeker",
        "headline": "Senior Backend Engineer",
        "summary": "Backend engineer with 7 years of experience building Python APIs on AWS.",
        "years_experience": 7,
        "location": "Berlin, Germany",
        "utc_offset": 1,
        "remote_preference": "any",
        "salary_min": 85000,
        "currency": "EUR",
        "skills": ["python", "postgresql", "docker", "aws", "fastapi", "redis"],
    }
    jobs = [make_job(rng) for _ in range(JOB_COUNT)]

    await embed_all(
        candidates,
        [candidate_embedding_text(_embeddable(c, "candidate")) for c in candidates],
        "document",
    )
    await embed_all(jobs, [job_embedding_text(_embeddable(j, "job")) for j in jobs], "query")

    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"organizations": ORGANIZATIONS, "candidates": candidates, "jobs": jobs})
    )
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    asyncio.run(main())
