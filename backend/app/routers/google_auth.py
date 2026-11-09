import logging
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import google_oauth
from app.auth import set_session_cookie
from app.config import get_settings
from app.db import get_session
from app.models import CandidateProfile, User
from app.rate_limit import client_ip, record_attempt
from app.routers.auth import register_limit, user_out
from app.schemas import GoogleSignupIn, Role, UserOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

COOKIE_PATH = "/api/auth/google"
STATE_COOKIE = "google_state"
STATE_AUDIENCE = "google-state"
STATE_LIFETIME = timedelta(minutes=10)
SIGNUP_COOKIE = "google_signup"
SIGNUP_AUDIENCE = "google-signup"
SIGNUP_LIFETIME = timedelta(minutes=15)


def _sign(claims: dict, audience: str, lifetime: timedelta) -> str:
    payload = {**claims, "aud": audience, "exp": datetime.now(UTC) + lifetime}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def _read(token: str | None, audience: str) -> dict | None:
    if token is None:
        return None
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], audience=audience)
    except jwt.PyJWTError:
        return None


def _set_flow_cookie(response: Response, name: str, value: str, lifetime: timedelta) -> None:
    response.set_cookie(
        name,
        value,
        httponly=True,
        samesite="lax",  # Google's redirect back is a top-level navigation, which Lax allows
        secure=get_settings().cookie_secure,
        max_age=int(lifetime.total_seconds()),
        path=COOKIE_PATH,
    )


def _redirect(path: str) -> RedirectResponse:
    response = RedirectResponse(f"{get_settings().app_base_url}{path}", status.HTTP_302_FOUND)
    response.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
    return response


async def _find_or_link_user(
    db: AsyncSession, identity: google_oauth.GoogleIdentity
) -> User | None:
    user = await db.scalar(select(User).where(User.google_sub == identity.subject))
    if user is not None:
        return user
    user = await db.scalar(select(User).where(User.email == identity.email))
    if user is None:
        return None
    if user.email_verified_at is None:
        # Anyone could have registered this address with a password before its real owner
        # arrived, so Google's proof of ownership ends whatever access they set up.
        user.password_hash = None
        user.session_version += 1
        user.email_verified_at = datetime.now(UTC)
    user.google_sub = identity.subject
    return user


@router.get("/auth/providers")
async def providers() -> dict[str, bool]:
    return {"google": google_oauth.is_configured()}


@router.get("/auth/google/start")
async def google_start(role: Role | None = None) -> RedirectResponse:
    if not google_oauth.is_configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google sign-in isn't set up")
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    response = RedirectResponse(google_oauth.authorization_url(state, nonce), status.HTTP_302_FOUND)
    flow = _sign({"state": state, "nonce": nonce, "role": role}, STATE_AUDIENCE, STATE_LIFETIME)
    _set_flow_cookie(response, STATE_COOKIE, flow, STATE_LIFETIME)
    return response


@router.get("/auth/google/callback")
async def google_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    flow_cookie: str | None = Cookie(default=None, alias=STATE_COOKIE),
    db: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    flow = _read(flow_cookie, STATE_AUDIENCE)
    if flow is None or state is None or not secrets.compare_digest(state, flow["state"]):
        return _redirect("/login?google=failed")
    if error:
        return _redirect("/login?google=cancelled")
    if not code:
        return _redirect("/login?google=failed")
    try:
        identity = await google_oauth.fetch_identity(code, flow["nonce"])
    except google_oauth.GoogleAuthError:
        logger.exception("Google sign-in failed")
        return _redirect("/login?google=failed")
    if not identity.email_verified:
        return _redirect("/login?google=unverified")

    user = await _find_or_link_user(db, identity)
    if user is None:
        role = flow.get("role")
        response = _redirect(f"/finish-signup?role={role}" if role else "/finish-signup")
        pending = _sign(
            {"sub": identity.subject, "email": identity.email}, SIGNUP_AUDIENCE, SIGNUP_LIFETIME
        )
        _set_flow_cookie(response, SIGNUP_COOKIE, pending, SIGNUP_LIFETIME)
        return response
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return _redirect("/login?google=failed")
    response = _redirect("/")
    set_session_cookie(response, user)
    return response


@router.get("/auth/google/pending")
async def google_pending(
    signup_cookie: str | None = Cookie(default=None, alias=SIGNUP_COOKIE),
) -> dict[str, str]:
    pending = _read(signup_cookie, SIGNUP_AUDIENCE)
    if pending is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your Google sign-in has expired")
    return {"email": pending["email"]}


@router.post("/auth/google/complete", status_code=status.HTTP_201_CREATED)
async def google_complete(
    body: GoogleSignupIn,
    request: Request,
    response: Response,
    signup_cookie: str | None = Cookie(default=None, alias=SIGNUP_COOKIE),
    db: AsyncSession = Depends(get_session),
) -> UserOut:
    await record_attempt(db, [register_limit(client_ip(request))])
    pending = _read(signup_cookie, SIGNUP_AUDIENCE)
    if pending is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Your Google sign-in has expired. Start again."
        )
    now = datetime.now(UTC)
    user = User(
        email=pending["email"],
        password_hash=None,
        google_sub=pending["sub"],
        role=body.role,
        consent_at=now,
        email_verified_at=now,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This account already exists. Log in instead."
        ) from exc
    if user.role == "seeker":
        db.add(CandidateProfile(user_id=user.id))
    await db.commit()
    response.delete_cookie(SIGNUP_COOKIE, path=COOKIE_PATH)
    set_session_cookie(response, user)
    return await user_out(db, user)
