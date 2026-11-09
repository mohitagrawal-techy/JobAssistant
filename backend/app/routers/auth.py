from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.models import CandidateProfile, Organization, OrgMember, User
from app.schemas import LoginIn, OrgIn, OrgOut, RegisterIn, UserOut

router = APIRouter(tags=["auth"])


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    org = await find_org(db, user.id) if user.role == "recruiter" else None
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        organization=OrgOut.model_validate(org) if org else None,
    )


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn, response: Response, db: AsyncSession = Depends(get_session)
) -> UserOut:
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
    await db.commit()
    set_session_cookie(response, user.id)
    return await _user_out(db, user)


@router.post("/auth/login")
async def login(
    body: LoginIn, response: Response, db: AsyncSession = Depends(get_session)
) -> UserOut:
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if not verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    set_session_cookie(response, user.id)
    return await _user_out(db, user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    clear_session_cookie(response)


@router.get("/auth/me")
async def me(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_session)
) -> UserOut:
    return await _user_out(db, user)


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
