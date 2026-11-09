import re
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import select, text

from app.db import SessionLocal
from app.mailer import SmtpEmailSender, _action_email, get_email_sender
from app.models import EmailToken
from tests.conftest import new_client

EMAIL = "seeker@example.com"
PASSWORD = "password123"
NEW_PASSWORD = "brand-new-password"


def outbox():
    return get_email_sender().outbox


def token_from(message) -> str:
    return re.search(r"token=([\w-]+)", message.get_body(("plain",)).get_content()).group(1)


async def request_reset(client, email=EMAIL) -> str:
    assert (
        await client.post("/api/auth/forgot-password", json={"email": email})
    ).status_code == 202
    return token_from(outbox()[-1])


async def login(client, password=PASSWORD, email=EMAIL):
    return await client.post("/api/auth/login", json={"email": email, "password": password})


async def test_register_emails_a_confirmation_link(seeker):
    assert (await seeker.get("/api/auth/me")).json()["email_verified"] is False
    assert outbox()[-1]["To"] == EMAIL
    response = await seeker.post("/api/auth/verify-email", json={"token": token_from(outbox()[-1])})
    assert response.status_code == 204
    assert (await seeker.get("/api/auth/me")).json()["email_verified"] is True


async def test_confirmation_link_works_once(seeker):
    token = token_from(outbox()[-1])
    assert (await seeker.post("/api/auth/verify-email", json={"token": token})).status_code == 204
    assert (await seeker.post("/api/auth/verify-email", json={"token": token})).status_code == 400


async def test_resend_replaces_the_link_and_is_limited(seeker):
    first = token_from(outbox()[-1])
    for _ in range(3):
        assert (await seeker.post("/api/auth/resend-verification")).status_code == 202
    assert (await seeker.post("/api/auth/resend-verification")).status_code == 429
    assert (await seeker.post("/api/auth/verify-email", json={"token": first})).status_code == 400
    latest = token_from(outbox()[-1])
    assert (await seeker.post("/api/auth/verify-email", json={"token": latest})).status_code == 204


async def test_resend_is_a_no_op_once_confirmed(seeker):
    await seeker.post("/api/auth/verify-email", json={"token": token_from(outbox()[-1])})
    sent = len(outbox())
    assert (await seeker.post("/api/auth/resend-verification")).status_code == 202
    assert len(outbox()) == sent


async def test_tokens_are_stored_hashed(seeker):
    token = token_from(outbox()[-1])
    async with SessionLocal() as db:
        stored = await db.scalar(select(EmailToken.token_hash))
    assert stored != token and token not in stored


async def test_reset_changes_password_and_signs_out_everywhere(seeker):
    async with new_client() as client:
        token = await request_reset(client)
        response = await client.post(
            "/api/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
        )
        assert response.status_code == 204
        assert (await seeker.get("/api/auth/me")).status_code == 401
        assert (await login(client)).status_code == 401
        assert (await login(client, NEW_PASSWORD)).status_code == 200
        assert (await client.get("/api/auth/me")).json()["email_verified"] is True


async def test_reset_link_works_once_and_rejects_short_passwords(seeker):
    async with new_client() as client:
        token = await request_reset(client)
        short = await client.post(
            "/api/auth/reset-password", json={"token": token, "password": "short"}
        )
        assert short.status_code == 422
        body = {"token": token, "password": NEW_PASSWORD}
        assert (await client.post("/api/auth/reset-password", json=body)).status_code == 204
        assert (await client.post("/api/auth/reset-password", json=body)).status_code == 400


async def test_expired_reset_link_is_rejected(seeker):
    async with new_client() as client:
        token = await request_reset(client)
        async with SessionLocal() as db:
            await db.execute(
                text("UPDATE email_tokens SET expires_at = :past WHERE purpose = 'reset'"),
                {"past": datetime.now(UTC) - timedelta(minutes=1)},
            )
            await db.commit()
        response = await client.post(
            "/api/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
        )
        assert response.status_code == 400
        assert (await login(client)).status_code == 200


async def test_a_verify_token_cannot_reset_a_password(seeker):
    token = token_from(outbox()[-1])
    response = await seeker.post(
        "/api/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}
    )
    assert response.status_code == 400


async def test_new_reset_request_cancels_the_previous_link(seeker):
    async with new_client() as client:
        first = await request_reset(client)
        await request_reset(client)
        response = await client.post(
            "/api/auth/reset-password", json={"token": first, "password": NEW_PASSWORD}
        )
        assert response.status_code == 400


async def test_forgot_password_does_not_reveal_unknown_emails(seeker):
    sent = len(outbox())
    async with new_client() as client:
        response = await client.post(
            "/api/auth/forgot-password", json={"email": "nobody@example.com"}
        )
    assert response.status_code == 202
    assert len(outbox()) == sent


async def test_forgot_password_stops_emailing_silently_after_the_limit(seeker):
    sent = len(outbox())
    async with new_client() as client:
        for _ in range(5):
            response = await client.post("/api/auth/forgot-password", json={"email": EMAIL})
            assert response.status_code == 202
    assert len(outbox()) == sent + 3


async def test_forgot_password_is_limited_per_ip():
    async with new_client() as client:
        for number in range(10):
            response = await client.post(
                "/api/auth/forgot-password", json={"email": f"user{number}@example.com"}
            )
            assert response.status_code == 202
        response = await client.post("/api/auth/forgot-password", json={"email": "x@example.com"})
    assert response.status_code == 429


async def test_login_locks_after_repeated_failures_even_with_the_right_password(seeker):
    async with new_client() as client:
        for _ in range(5):
            assert (await login(client, "wrong-password")).status_code == 401
        blocked = await login(client)
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0
    assert "Try again in" in blocked.json()["detail"]


async def test_login_lock_is_per_account(seeker):
    async with new_client() as client:
        for _ in range(6):
            await login(client, "wrong-password")
        response = await login(client, email="unknown@example.com")
    assert response.status_code == 401


async def test_unknown_emails_are_limited_the_same_way():
    async with new_client() as client:
        for _ in range(5):
            assert (await login(client, email="ghost@example.com")).status_code == 401
        assert (await login(client, email="ghost@example.com")).status_code == 429


async def test_successful_login_clears_failures(seeker):
    async with new_client() as client:
        for _ in range(4):
            await login(client, "wrong-password")
        assert (await login(client)).status_code == 200
        for _ in range(4):
            assert (await login(client, "wrong-password")).status_code == 401
        assert (await login(client)).status_code == 200


async def test_rate_limit_keys_hold_no_personal_data(seeker):
    async with new_client() as client:
        await login(client, "wrong-password")
    async with SessionLocal() as db:
        keys = (await db.scalars(text("SELECT key FROM rate_limit_events"))).all()
    assert keys and not any("@" in key for key in keys)


async def test_forwarded_ip_is_ignored_unless_a_proxy_is_trusted(seeker):
    async with new_client() as client:
        for number in range(6):
            response = await client.post(
                "/api/auth/login",
                json={"email": EMAIL, "password": "wrong-password"},
                headers={"X-Forwarded-For": f"10.0.0.{number}"},
            )
    assert response.status_code == 429


async def test_smtp_sender_uses_tls_and_login():
    message = _action_email("a@example.com", "Hi", "Intro", "Go", "http://x/y", "Bye")
    with (
        patch("app.mailer.smtplib.SMTP") as smtp,
        patch("app.mailer.get_settings") as settings,
    ):
        settings.return_value.smtp_host = "mail.example.com"
        settings.return_value.smtp_port = 587
        settings.return_value.smtp_starttls = True
        settings.return_value.smtp_username = "user"
        settings.return_value.smtp_password = "pass"
        await SmtpEmailSender().send(message)
    client = smtp.return_value.__enter__.return_value
    smtp.assert_called_once_with("mail.example.com", 587, timeout=15)
    client.starttls.assert_called_once()
    client.login.assert_called_once_with("user", "pass")
    client.send_message.assert_called_once_with(message)


async def test_a_mail_outage_does_not_break_sign_up():
    with patch.object(get_email_sender(), "send", side_effect=OSError("mail is down")):
        async with new_client() as client:
            response = await client.post(
                "/api/auth/register",
                json={"email": EMAIL, "password": PASSWORD, "role": "seeker", "consent": True},
            )
    assert response.status_code == 201
