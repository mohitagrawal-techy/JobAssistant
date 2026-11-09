"""Outgoing email. Choose a sender with EMAIL_PROVIDER: console, smtp or fake (tests)."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from functools import lru_cache
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 15


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> None: ...


class ConsoleEmailSender:
    """Development only: prints each email, including its link, to the server log."""

    async def send(self, message: EmailMessage) -> None:
        body = message.get_body(("plain",))
        print(
            f"--- Email to {message['To']}: {message['Subject']}\n{body.get_content()}", flush=True
        )


class SmtpEmailSender:
    async def send(self, message: EmailMessage) -> None:
        await asyncio.to_thread(self._deliver, message)

    def _deliver(self, message: EmailMessage) -> None:
        settings = get_settings()
        with smtplib.SMTP(
            settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS
        ) as smtp:
            if settings.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)


class FakeEmailSender:
    def __init__(self) -> None:
        self.outbox: list[EmailMessage] = []

    async def send(self, message: EmailMessage) -> None:
        self.outbox.append(message)


@lru_cache
def get_email_sender() -> EmailSender:
    settings = get_settings()
    if settings.email_provider == "fake":
        return FakeEmailSender()
    if settings.email_provider == "console":
        return ConsoleEmailSender()
    if not settings.smtp_host:
        raise ValueError("EMAIL_PROVIDER=smtp needs SMTP_HOST")
    return SmtpEmailSender()


def _action_email(
    to: str, subject: str, intro: str, action: str, url: str, closing: str
) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = get_settings().email_from
    message["To"] = to
    message.set_content(f"{intro}\n\n{action}: {url}\n\n{closing}\n")
    message.add_alternative(
        f"""\
<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1b1442;line-height:1.5">
  <p style="font-size:20px;font-weight:800;color:#4c1d95">KHOJ</p>
  <p>{intro}</p>
  <p><a href="{url}" style="display:inline-block;background:#f59e0b;color:#1b1442;font-weight:600;
    padding:10px 18px;border-radius:999px;text-decoration:none">{action}</a></p>
  <p style="font-size:14px;color:#635a88">{closing}</p>
</div>
""",
        subtype="html",
    )
    return message


async def _send_safely(message: EmailMessage) -> None:
    # Runs after the response is sent, so a mail outage must not surface as a server error.
    try:
        await get_email_sender().send(message)
    except Exception:
        logger.exception("Could not send email: %s", message["Subject"])


async def send_verification_email(to: str, token: str) -> None:
    url = f"{get_settings().app_base_url}/verify-email?token={token}"
    await _send_safely(
        _action_email(
            to,
            "Confirm your email for Khoj",
            "Confirm this email address to finish setting up your Khoj account.",
            "Confirm my email",
            url,
            "This link expires in 48 hours. If you didn't sign up for Khoj, you can ignore this.",
        )
    )


async def send_password_reset_email(to: str, token: str) -> None:
    url = f"{get_settings().app_base_url}/reset-password?token={token}"
    await _send_safely(
        _action_email(
            to,
            "Reset your Khoj password",
            "We received a request to reset your Khoj password.",
            "Reset my password",
            url,
            "This link expires in 1 hour. If you didn't ask for this, your password hasn't changed "
            "and you can ignore this.",
        )
    )
