"""Single-use links sent by email. Only a hash is stored, so a database leak exposes no links."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailToken, User

Purpose = Literal["verify", "reset"]

LIFETIMES: dict[Purpose, timedelta] = {
    "verify": timedelta(hours=48),
    "reset": timedelta(hours=1),
}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_token(db: AsyncSession, user_id: uuid.UUID, purpose: Purpose) -> str:
    """Create a link token, replacing any earlier one. The caller commits."""
    await db.execute(
        delete(EmailToken).where(EmailToken.user_id == user_id, EmailToken.purpose == purpose)
    )
    token = secrets.token_urlsafe(32)
    db.add(
        EmailToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=_digest(token),
            expires_at=datetime.now(UTC) + LIFETIMES[purpose],
        )
    )
    return token


async def consume_token(db: AsyncSession, token: str, purpose: Purpose) -> User | None:
    """Use up a token and return its owner. A single delete means two requests can't both win."""
    row = (
        await db.execute(
            delete(EmailToken)
            .where(EmailToken.token_hash == _digest(token), EmailToken.purpose == purpose)
            .returning(EmailToken.user_id, EmailToken.expires_at)
        )
    ).first()
    if row is None or row.expires_at <= datetime.now(UTC):
        return None
    return await db.get(User, row.user_id)
