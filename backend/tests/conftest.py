"""API tests run against a real Postgres + pgvector database with fake AI providers."""

import os
import re

os.environ["LLM_PROVIDER"] = "fake"
os.environ["ASSISTANT_SCHEDULER_ENABLED"] = "false"
os.environ["EMBEDDING_PROVIDER"] = "fake"
os.environ["EMAIL_PROVIDER"] = "fake"
os.environ["GOOGLE_CLIENT_ID"] = "test-google-client"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-google-secret"
os.environ["APP_BASE_URL"] = "http://localhost:5173"
os.environ["STORAGE_DIR"] = "/tmp/jobassistent-test-storage"
_admin_url = os.environ.get(
    "DATABASE_URL", "postgresql+asyncpg://jobassistent:jobassistent@localhost:5432/jobassistent"
)
_test_url = re.sub(r"/[^/]+$", "/jobassistent_test", _admin_url)
os.environ["DATABASE_URL"] = _test_url

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.db import engine  # noqa: E402
from app.mailer import get_email_sender  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def database():
    admin = create_async_engine(_admin_url, isolation_level="AUTOCOMMIT")
    async with admin.connect() as connection:
        await connection.execute(text("DROP DATABASE IF EXISTS jobassistent_test WITH (FORCE)"))
        await connection.execute(text("CREATE DATABASE jobassistent_test"))
    await admin.dispose()
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_tables(database):
    yield
    names = ", ".join(table.name for table in Base.metadata.sorted_tables)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {names} CASCADE"))
    get_email_sender().outbox.clear()


def new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def seeker():
    async with new_client() as client:
        response = await client.post(
            "/api/auth/register",
            json={
                "email": "seeker@example.com",
                "password": "password123",
                "role": "seeker",
                "consent": True,
            },
        )
        assert response.status_code == 201
        yield client


async def register_recruiter(client: AsyncClient, email: str, org_name: str) -> None:
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": "recruiter", "consent": True},
    )
    assert response.status_code == 201
    response = await client.post("/api/organization", json={"name": org_name, "type": "agency"})
    assert response.status_code == 201


@pytest_asyncio.fixture
async def recruiter():
    async with new_client() as client:
        await register_recruiter(client, "recruiter@example.com", "Acme Talent")
        yield client


@pytest_asyncio.fixture
async def other_recruiter():
    async with new_client() as client:
        await register_recruiter(client, "other@example.com", "Rival Talent")
        yield client
