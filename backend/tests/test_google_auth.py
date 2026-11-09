from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import jwt
from sqlalchemy import select, text

from app import google_oauth
from app.db import SessionLocal
from app.models import User
from tests.conftest import new_client

CLIENT_ID = "test-google-client"
EMAIL = "person@gmail.com"
PASSWORD = "password123"


def id_token(nonce: str, **overrides) -> str:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "exp": datetime.now(UTC) + timedelta(minutes=5),
        "sub": "google-subject-1",
        "email": EMAIL,
        "email_verified": True,
        "nonce": nonce,
        **overrides,
    }
    return jwt.encode(claims, "x" * 32, algorithm="HS256")


async def sign_in(client, role=None, **claims):
    """Run the browser's side of the flow, with Google's token response faked."""
    start = await client.get("/api/auth/google/start", params={"role": role} if role else None)
    assert start.status_code == 302
    query = parse_qs(urlparse(start.headers["location"]).query)
    token = id_token(claims.pop("nonce", query["nonce"][0]), **claims)
    with patch.object(google_oauth, "_post_token", AsyncMock(return_value={"id_token": token})):
        return await client.get(
            "/api/auth/google/callback", params={"code": "abc", "state": query["state"][0]}
        )


async def register(client, email=EMAIL):
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "role": "seeker", "consent": True},
    )
    assert response.status_code == 201


async def password_login(client, email=EMAIL):
    return await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})


async def mark_verified():
    async with SessionLocal() as db:
        await db.execute(text("UPDATE users SET email_verified_at = now()"))
        await db.commit()


def location(response) -> str:
    return response.headers["location"].removeprefix("http://localhost:5173")


async def test_start_sends_the_browser_to_google():
    async with new_client() as client:
        response = await client.get("/api/auth/google/start")
    target = urlparse(response.headers["location"])
    query = parse_qs(target.query)
    assert target.netloc == "accounts.google.com"
    assert query["client_id"] == [CLIENT_ID]
    assert query["redirect_uri"] == ["http://localhost:5173/api/auth/google/callback"]
    assert query["scope"] == ["openid email"]
    assert query["state"] and query["nonce"]


async def test_providers_and_start_when_not_configured():
    with patch.object(google_oauth, "is_configured", return_value=False):
        async with new_client() as client:
            assert (await client.get("/api/auth/providers")).json() == {"google": False}
            assert (await client.get("/api/auth/google/start")).status_code == 404


async def test_new_user_chooses_a_role_and_consents():
    async with new_client() as client:
        response = await sign_in(client, role="recruiter")
        assert location(response) == "/finish-signup?role=recruiter"
        assert (await client.get("/api/auth/me")).status_code == 401
        assert (await client.get("/api/auth/google/pending")).json() == {"email": EMAIL}

        refused = await client.post(
            "/api/auth/google/complete", json={"role": "recruiter", "consent": False}
        )
        assert refused.status_code == 422

        created = await client.post(
            "/api/auth/google/complete", json={"role": "recruiter", "consent": True}
        )
        assert created.status_code == 201
        me = (await client.get("/api/auth/me")).json()
        assert me["email"] == EMAIL and me["role"] == "recruiter" and me["email_verified"] is True


async def test_seeker_signup_gets_a_profile_and_returning_user_goes_straight_in():
    async with new_client() as client:
        await sign_in(client)
        await client.post("/api/auth/google/complete", json={"role": "seeker", "consent": True})
        assert (await client.get("/api/profile")).status_code == 200
    async with new_client() as client:
        response = await sign_in(client)
        assert location(response) == "/"
        assert (await client.get("/api/auth/me")).status_code == 200


async def test_pending_signup_can_only_be_completed_once():
    async with new_client() as client:
        await sign_in(client)
        kept = client.cookies.get("google_signup")
        body = {"role": "seeker", "consent": True}
        assert (await client.post("/api/auth/google/complete", json=body)).status_code == 201
        client.cookies.set("google_signup", kept, path="/api/auth/google")
        assert (await client.post("/api/auth/google/complete", json=body)).status_code == 409


async def test_complete_without_google_sign_in_is_refused():
    async with new_client() as client:
        response = await client.post(
            "/api/auth/google/complete", json={"role": "seeker", "consent": True}
        )
    assert response.status_code == 401


async def test_flow_cookies_cannot_be_used_as_a_login():
    async with new_client() as client:
        await sign_in(client)
        pending = client.cookies.get("google_signup")
        client.cookies.set("session", pending)
        assert (await client.get("/api/auth/me")).status_code == 401


async def test_links_a_confirmed_account_and_keeps_its_password():
    async with new_client() as owner:
        await register(owner)
        await mark_verified()
        assert location(await sign_in(owner)) == "/"
    async with new_client() as client:
        assert (await password_login(client)).status_code == 200


async def test_linking_an_unconfirmed_account_removes_the_squatters_access():
    async with new_client() as squatter:
        await register(squatter)
        async with new_client() as owner:
            assert location(await sign_in(owner)) == "/"
            assert (await owner.get("/api/auth/me")).json()["email_verified"] is True
        assert (await squatter.get("/api/auth/me")).status_code == 401
        assert (await password_login(squatter)).status_code == 401


async def test_email_case_is_ignored_when_linking():
    async with new_client() as owner:
        await register(owner)
        await mark_verified()
    async with new_client() as client:
        assert location(await sign_in(client, email="Person@Gmail.com")) == "/"


async def test_google_subject_wins_after_the_email_changes():
    async with new_client() as client:
        await sign_in(client)
        await client.post("/api/auth/google/complete", json={"role": "seeker", "consent": True})
    async with new_client() as client:
        assert location(await sign_in(client, email="renamed@gmail.com")) == "/"
        assert (await client.get("/api/auth/me")).json()["email"] == EMAIL


async def test_google_only_account_cannot_use_a_password_until_it_sets_one():
    async with new_client() as client:
        await sign_in(client)
        await client.post("/api/auth/google/complete", json={"role": "seeker", "consent": True})
    async with SessionLocal() as db:
        assert (await db.scalar(select(User.password_hash))) is None
    async with new_client() as client:
        assert (await password_login(client)).status_code == 401


async def test_wrong_state_is_rejected_without_contacting_google():
    async with new_client() as client:
        await client.get("/api/auth/google/start")
        with patch.object(google_oauth, "_post_token", AsyncMock()) as post:
            response = await client.get(
                "/api/auth/google/callback", params={"code": "abc", "state": "forged"}
            )
    assert location(response) == "/login?google=failed"
    post.assert_not_called()


async def test_callback_without_the_browser_cookie_is_rejected():
    async with new_client() as client:
        response = await client.get(
            "/api/auth/google/callback", params={"code": "abc", "state": "anything"}
        )
    assert location(response) == "/login?google=failed"


async def test_user_cancelling_at_google():
    async with new_client() as client:
        start = await client.get("/api/auth/google/start")
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        response = await client.get(
            "/api/auth/google/callback", params={"error": "access_denied", "state": state}
        )
    assert location(response) == "/login?google=cancelled"


async def test_unverified_google_email_is_refused():
    async with new_client() as client:
        response = await sign_in(client, email_verified=False)
    assert location(response) == "/login?google=unverified"
    assert client.cookies.get("google_signup") is None


async def test_bad_id_tokens_are_refused():
    cases = [
        {"iss": "https://evil.example.com"},
        {"aud": "another-app"},
        {"exp": datetime.now(UTC) - timedelta(minutes=5)},
        {"nonce": "replayed-nonce"},
    ]
    for claims in cases:
        async with new_client() as client:
            response = await sign_in(client, **claims)
        assert location(response) == "/login?google=failed", claims


async def test_google_outage_shows_a_failure():
    async with new_client() as client:
        start = await client.get("/api/auth/google/start")
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        failure = AsyncMock(side_effect=google_oauth.GoogleAuthError("down"))
        with patch.object(google_oauth, "_post_token", failure):
            response = await client.get(
                "/api/auth/google/callback", params={"code": "abc", "state": state}
            )
    assert location(response) == "/login?google=failed"
