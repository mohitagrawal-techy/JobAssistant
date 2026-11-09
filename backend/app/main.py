import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import scheduler_loop
from app.config import get_settings
from app.db import get_session
from app.routers import (
    applications,
    assistant,
    auth,
    google_auth,
    hiring_tools,
    jobs,
    matches,
    profile,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(scheduler_loop()) if settings.assistant_scheduler_enabled else None
    yield
    if task is not None:
        task.cancel()


app = FastAPI(title="Khoj API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
for module in (auth, google_auth, profile, assistant, hiring_tools, jobs, matches, applications):
    app.include_router(module.router, prefix="/api")


async def _ollama_reachable() -> bool:
    if settings.llm_provider != "ollama":
        return False
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            response = await client.get(f"{settings.llm_base_url}/api/version")
        return response.status_code == 200
    except httpx.HTTPError:
        return False


@app.get("/api/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict:
    try:
        await session.execute(text("SELECT 1"))
        database = True
    except (SQLAlchemyError, OSError):
        database = False
    return {
        "status": "ok" if database else "degraded",
        "database": database,
        "llm_provider": settings.llm_provider,
        "ollama": await _ollama_reachable(),
    }
