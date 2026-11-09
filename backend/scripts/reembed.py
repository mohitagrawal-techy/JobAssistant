"""Recompute embeddings that don't come from the current EMBEDDING_MODEL.

Run after changing embedding models. Usage: python -m scripts.reembed
"""

import asyncio

from sqlalchemy import or_, select

from app.ai.factory import get_embedder
from app.ai.tasks import refresh_candidate_embedding, refresh_job_embedding
from app.db import SessionLocal
from app.models import CandidateProfile, Job


async def main() -> None:
    model = get_embedder().model
    async with SessionLocal() as db:
        candidates = (
            await db.scalars(
                select(CandidateProfile.id).where(
                    or_(
                        CandidateProfile.embedding_model.is_(None),
                        CandidateProfile.embedding_model != model,
                    )
                )
            )
        ).all()
        jobs = (
            await db.scalars(
                select(Job.id).where(
                    or_(Job.embedding_model.is_(None), Job.embedding_model != model)
                )
            )
        ).all()
    for candidate_id in candidates:
        await refresh_candidate_embedding(candidate_id)
    for job_id in jobs:
        await refresh_job_embedding(job_id)
    print(f"Re-embedded {len(candidates)} candidates and {len(jobs)} jobs with {model}.")


if __name__ == "__main__":
    asyncio.run(main())
