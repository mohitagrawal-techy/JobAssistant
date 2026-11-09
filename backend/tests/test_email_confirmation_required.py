import pytest_asyncio
from sqlalchemy import text

from app.assistant import run_all_enabled
from app.db import SessionLocal
from tests.conftest import confirm_latest_email, new_client
from tests.test_api import JOB, publish_job, save_profile
from tests.test_assistant import ASK, AUTO, configure, run, state


async def set_confirmed(email: str, confirmed: bool) -> None:
    async with SessionLocal() as db:
        await db.execute(
            text(
                "UPDATE users SET email_verified_at = CASE WHEN :confirmed THEN now() END "
                "WHERE email = :email"
            ),
            {"confirmed": confirmed, "email": email},
        )
        await db.commit()


async def register(client, email: str, role: str) -> None:
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "role": role, "consent": True},
    )
    assert response.status_code == 201


@pytest_asyncio.fixture
async def unconfirmed_seeker():
    async with new_client() as client:
        await register(client, "new-seeker@example.com", "seeker")
        yield client


@pytest_asyncio.fixture
async def unconfirmed_recruiter():
    async with new_client() as client:
        await register(client, "new-recruiter@example.com", "recruiter")
        response = await client.post(
            "/api/organization", json={"name": "New Co", "type": "company"}
        )
        assert response.status_code == 201
        yield client


async def test_applying_needs_a_confirmed_email(recruiter, unconfirmed_seeker):
    job_id = await publish_job(recruiter)
    await save_profile(unconfirmed_seeker)
    blocked = await unconfirmed_seeker.post("/api/applications", json={"job_id": job_id})
    assert blocked.status_code == 403
    assert "Confirm your email" in blocked.json()["detail"]

    await confirm_latest_email(unconfirmed_seeker)
    applied = await unconfirmed_seeker.post("/api/applications", json={"job_id": job_id})
    assert applied.status_code == 201


async def test_publishing_needs_a_confirmed_email_but_drafting_does_not(unconfirmed_recruiter):
    draft = await unconfirmed_recruiter.post(
        "/api/org/jobs/draft", json={"description": "Backend Engineer needed for our team"}
    )
    job_id = draft.json()["id"]
    saved = await unconfirmed_recruiter.put(f"/api/org/jobs/{job_id}", json=JOB)
    assert saved.status_code == 200

    body = {"status": "open"}
    url = f"/api/org/jobs/{job_id}/status"
    assert (await unconfirmed_recruiter.patch(url, json=body)).status_code == 403
    await confirm_latest_email(unconfirmed_recruiter)
    assert (await unconfirmed_recruiter.patch(url, json=body)).status_code == 200


async def test_an_unconfirmed_recruiter_can_still_close_a_job(recruiter):
    job_id = await publish_job(recruiter)
    await set_confirmed("recruiter@example.com", False)
    url = f"/api/org/jobs/{job_id}/status"
    assert (await recruiter.patch(url, json={"status": "closed"})).status_code == 200


async def test_turning_on_the_assistant_needs_a_confirmed_email(unconfirmed_seeker):
    blocked = await unconfirmed_seeker.put("/api/assistant/settings", json=ASK)
    assert blocked.status_code == 403
    turned_off = await unconfirmed_seeker.put(
        "/api/assistant/settings", json={**ASK, "enabled": False}
    )
    assert turned_off.status_code == 200


async def test_assistant_cannot_run_or_be_approved_while_unconfirmed(recruiter, seeker):
    await publish_job(recruiter)
    await save_profile(seeker)
    await configure(seeker)
    await run(seeker)
    action = (await state(seeker))["pending"][0]

    await set_confirmed("seeker@example.com", False)
    assert (await seeker.post("/api/assistant/run")).status_code == 403
    response = await seeker.post(
        f"/api/assistant/actions/{action['id']}/approve", json={"note": "A note."}
    )
    assert response.status_code == 403


async def test_scheduled_runs_skip_unconfirmed_accounts(recruiter, seeker):
    await publish_job(recruiter)
    await save_profile(seeker)
    await configure(seeker, **AUTO)

    await set_confirmed("seeker@example.com", False)
    await run_all_enabled()
    assert (await seeker.get("/api/applications")).json() == []

    await set_confirmed("seeker@example.com", True)
    await run_all_enabled()
    assert len((await seeker.get("/api/applications")).json()) == 1


async def test_unconfirmed_accounts_can_still_build_a_profile(unconfirmed_seeker):
    await save_profile(unconfirmed_seeker)
    assert (await unconfirmed_seeker.get("/api/profile")).status_code == 200
