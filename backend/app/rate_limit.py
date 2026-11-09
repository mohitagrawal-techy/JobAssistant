"""Attempt limits stored in Postgres, so they hold across restarts and server processes."""

import hashlib
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import RateLimitEvent

# Longer than any window in use, so old rows can always be purged.
RETENTION = timedelta(days=1)


@dataclass(frozen=True)
class Limit:
    key: str
    max_attempts: int
    window: timedelta

    @property
    def hashed_key(self) -> str:
        return _hash(self.key)


class RateLimited(HTTPException):
    def __init__(self, retry_after: int) -> None:
        minutes = math.ceil(retry_after / 60)
        unit = "minute" if minutes == 1 else "minutes"
        super().__init__(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many attempts. Try again in {minutes} {unit}.",
            headers={"Retry-After": str(retry_after)},
        )


def _hash(key: str) -> str:
    # Keys contain emails and IP addresses, which shouldn't outlive a deleted account.
    return hashlib.sha256(key.encode()).hexdigest()


def client_ip(request: Request) -> str:
    """The caller's address. X-Forwarded-For is only read past proxies we were told to trust."""
    hops = get_settings().trusted_proxy_count
    if hops:
        forwarded = [
            part.strip()
            for part in request.headers.get("x-forwarded-for", "").split(",")
            if part.strip()
        ]
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"


async def record_attempt(db: AsyncSession, limits: Sequence[Limit]) -> list[uuid.UUID]:
    """Count this attempt against each limit, raising RateLimited if any is exceeded.

    Returns the recorded event ids, so an attempt that succeeds can be taken back.
    """
    now = datetime.now(UTC)
    await db.execute(delete(RateLimitEvent).where(RateLimitEvent.created_at < now - RETENTION))
    events = [
        RateLimitEvent(id=uuid.uuid4(), key=limit.hashed_key, created_at=now) for limit in limits
    ]
    db.add_all(events)
    # Committed before counting, so requests sent in parallel see each other.
    await db.commit()
    event_ids = [event.id for event in events]

    for limit in limits:
        since = now - limit.window
        count, oldest = (
            await db.execute(
                select(func.count(), func.min(RateLimitEvent.created_at)).where(
                    RateLimitEvent.key == limit.hashed_key, RateLimitEvent.created_at > since
                )
            )
        ).one()
        if count > limit.max_attempts:
            # Rejected attempts aren't kept, so continued guessing can't extend someone's lockout.
            await release_attempt(db, event_ids)
            await db.commit()
            raise RateLimited(max(1, math.ceil((oldest + limit.window - now).total_seconds())))
    return event_ids


async def release_attempt(db: AsyncSession, event_ids: Sequence[uuid.UUID]) -> None:
    await db.execute(delete(RateLimitEvent).where(RateLimitEvent.id.in_(event_ids)))


async def clear_limits(db: AsyncSession, limits: Sequence[Limit]) -> None:
    keys = [limit.hashed_key for limit in limits]
    await db.execute(delete(RateLimitEvent).where(RateLimitEvent.key.in_(keys)))
