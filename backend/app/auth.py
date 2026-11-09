import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Organization, OrgMember, User

COOKIE_NAME = "session"
TOKEN_LIFETIME = timedelta(days=7)

_hasher = PasswordHasher()
# Verified against when the email is unknown, so response time doesn't reveal registered emails.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return password_hash is not None


def set_session_cookie(response: Response, user: User) -> None:
    settings = get_settings()
    token = jwt.encode(
        {
            "sub": str(user.id),
            "ver": user.session_version,
            "exp": datetime.now(UTC) + TOKEN_LIFETIME,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=int(TOKEN_LIFETIME.total_seconds()),
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME)


async def current_user(
    session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_session),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    if session is None:
        raise unauthorized
    try:
        payload = jwt.decode(session, get_settings().jwt_secret, algorithms=["HS256"])
        user_id = uuid.UUID(payload["sub"])
        version = payload.get("ver", 0)
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise unauthorized from exc
    user = await db.get(User, user_id)
    if user is None or user.session_version != version:
        raise unauthorized
    return user


def ensure_email_confirmed(user: User) -> None:
    if user.email_verified_at is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Confirm your email first. Use the link we sent you, or send it again from the "
            "banner at the top of this page.",
        )


async def current_confirmed_user(user: User = Depends(current_user)) -> User:
    ensure_email_confirmed(user)
    return user


async def current_seeker(user: User = Depends(current_user)) -> User:
    if user.role != "seeker":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Job seeker account required")
    return user


async def current_recruiter(user: User = Depends(current_user)) -> User:
    if user.role != "recruiter":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Recruiter account required")
    return user


async def find_org(db: AsyncSession, user_id: uuid.UUID) -> Organization | None:
    return await db.scalar(
        select(Organization)
        .join(OrgMember, OrgMember.org_id == Organization.id)
        .where(OrgMember.user_id == user_id)
    )


async def current_org(
    user: User = Depends(current_recruiter),
    db: AsyncSession = Depends(get_session),
) -> Organization:
    org = await find_org(db, user.id)
    if org is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Set up your organization first")
    return org
