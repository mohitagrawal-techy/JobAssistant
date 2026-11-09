from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.account_tokens import consume_token, issue_token
from app.auth import (
    clear_session_cookie,
    current_recruiter,
    current_user,
    find_org,
    hash_password,
    set_session_cookie,
    verify_password,
)
from app.db import get_session
from app.mailer import send_password_reset_email, send_verification_email
from app.models import CandidateProfile, Organization, OrgMember, User
from app.rate_limit import (
    Limit,
    RateLimited,
    clear_limits,
    client_ip,
    record_attempt,
    release_attempt,
)
from app.schemas import (
    ForgotPasswordIn,
    LoginIn,
    OrgIn,
    OrgOut,
    RegisterIn,
    ResetPasswordIn,
    UserOut,
    VerifyEmailIn,
)

router = APIRouter(tags=["auth"])

FIFTEEN_MINUTES = timedelta(minutes=15)
ONE_HOUR = timedelta(hours=1)


def register_limit(ip: str) -> Limit:
    return Limit(f"register-ip:{ip}", 20, ONE_HOUR)


def _login_account_limits(email: str, ip: str) -> list[Limit]:
    return [
        Limit(f"login:{email}:{ip}", 5, FIFTEEN_MINUTES),
        # Catches guessing spread across many addresses, so it's looser to limit lockouts.
        Limit(f"login-email:{email}", 20, ONE_HOUR),
    ]


async def user_out(db: AsyncSession, user: User) -> UserOut:
    org = await find_org(db, user.id) if user.role == "recruiter" else None
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        email_verified=user.email_verified_at is not None,
        full_name=user.full_name,
        picture_url=user.picture_url,
        organization=OrgOut.model_validate(org) if org else None,
    )


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_session),
) -> UserOut:
    await record_attempt(db, [register_limit(client_ip(request))])
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
        consent_at=datetime.now(UTC),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is already registered") from exc
    if user.role == "seeker":
        db.add(CandidateProfile(user_id=user.id))
    token = await issue_token(db, user.id, "verify")
    await db.commit()
    background.add_task(send_verification_email, user.email, token)
    set_session_cookie(response, user)
    return await user_out(db, user)


@router.post("/auth/login")
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> UserOut:
    email = body.email.lower()
    ip = client_ip(request)
    account_limits = _login_account_limits(email, ip)
    attempt = await record_attempt(
        db, [*account_limits, Limit(f"login-ip:{ip}", 50, FIFTEEN_MINUTES)]
    )
    user = await db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    await clear_limits(db, account_limits)
    await release_attempt(db, attempt)
    await db.commit()
    set_session_cookie(response, user)
    return await user_out(db, user)


@router.post("/auth/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: ForgotPasswordIn,
    request: Request,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_session),
) -> None:
    email = body.email.lower()
    await record_attempt(db, [Limit(f"forgot-ip:{client_ip(request)}", 10, ONE_HOUR)])
    try:
        await record_attempt(db, [Limit(f"forgot-email:{email}", 3, ONE_HOUR)])
    except RateLimited:
        return  # An error here would show that this address is being targeted.
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        return
    token = await issue_token(db, user.id, "reset")
    await db.commit()
    background.add_task(send_password_reset_email, user.email, token)


@router.post("/auth/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(body: ResetPasswordIn, db: AsyncSession = Depends(get_session)) -> None:
    user = await consume_token(db, body.token, "reset")
    if user is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This reset link is invalid or has expired. Request a new one.",
        )
    user.password_hash = hash_password(body.password)
    user.session_version += 1  # signs out every device, including anyone who had the old password
    # Opening the emailed link proves they control this address.
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    await clear_limits(db, [Limit(f"login-email:{user.email}", 20, ONE_HOUR)])
    await db.commit()


@router.post("/auth/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(body: VerifyEmailIn, db: AsyncSession = Depends(get_session)) -> None:
    user = await consume_token(db, body.token, "verify")
    if user is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This confirmation link is invalid or has expired. Log in to get a new one.",
        )
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    await db.commit()


@router.post("/auth/resend-verification", status_code=status.HTTP_202_ACCEPTED)
async def resend_verification(
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    if user.email_verified_at is not None:
        return
    await record_attempt(db, [Limit(f"resend-verify:{user.id}", 3, ONE_HOUR)])
    token = await issue_token(db, user.id, "verify")
    await db.commit()
    background.add_task(send_verification_email, user.email, token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    clear_session_cookie(response)


@router.get("/auth/me")
async def me(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_session)
) -> UserOut:
    return await user_out(db, user)


@router.post("/organization", status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrgIn,
    user: User = Depends(current_recruiter),
    db: AsyncSession = Depends(get_session),
) -> OrgOut:
    if await find_org(db, user.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already belong to an organization")
    org = Organization(name=body.name, type=body.type)
    db.add(org)
    await db.flush()
    db.add(OrgMember(user_id=user.id, org_id=org.id))
    await db.commit()
    return OrgOut.model_validate(org)
