import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, get_db, require_rate_limit
from app.core.limiter import rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.db.base import utcnow
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.api import LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


def _as_utc(dt: datetime) -> datetime:
    """SQLite (and some drivers) drop tzinfo; treat naive values as UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/api/auth")


async def _revoke_family(db: AsyncSession, family_id: uuid.UUID) -> None:
    """Revoke every still-active refresh token in a rotation family."""
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow())
    )


async def _issue_session(
    db: AsyncSession,
    user: User,
    response: Response,
    request: Request,
    family_id: uuid.UUID | None = None,
) -> TokenOut:
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=_sha256(raw),
            expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
            user_agent=request.headers.get("user-agent", "")[:255] or None,
        )
    )
    await db.commit()
    _set_refresh_cookie(response, raw)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.from_model(user))


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, request: Request, response: Response,
                   db: AsyncSession = Depends(get_db)) -> TokenOut:
    # Rate-limit after body validation so 422s do not burn the Redis bucket.
    ip = request.client.host if request.client else "unknown"
    if not await rate_limit(f"rl:register:{ip}", 30, 3600):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
    email = body.email.lower().strip()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    if await db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username taken")

    user = User(email=email, username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    return await _issue_session(db, user, response, request)


@router.post("/login", response_model=TokenOut,
             dependencies=[Depends(require_rate_limit("login", limit=10, window_seconds=60))])
async def login(body: LoginIn, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)) -> TokenOut:
    user = await db.scalar(select(User).where(User.email == body.email.lower().strip()))
    # Constant-ish behavior whether or not the account exists.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    return await _issue_session(db, user, response, request)


@router.post("/refresh", response_model=TokenOut)
async def refresh(request: Request, response: Response,
                  db: AsyncSession = Depends(get_db)) -> TokenOut:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")
    row = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _sha256(raw)))
    now = utcnow()
    # Rotation + reuse detection: a consumed/unknown token revokes the whole family.
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if row.revoked_at is not None:
        # Reuse of a rotated token: steal-in-progress. Kill the family.
        await _revoke_family(db, row.family_id)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if _as_utc(row.expires_at) < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    family_id = row.family_id
    row.revoked_at = now  # rotate
    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        await _revoke_family(db, family_id)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User unavailable")
    return await _issue_session(db, user, response, request, family_id=family_id)


@router.post("/logout")
async def logout(request: Request, response: Response,
                 db: AsyncSession = Depends(get_db)) -> dict:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        row = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _sha256(raw)))
        if row is not None:
            row.revoked_at = utcnow()
            await db.commit()
    _clear_refresh_cookie(response)
    return {"ok": True}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password", response_model=TokenOut,
             dependencies=[Depends(require_rate_limit("chpass", limit=5, window_seconds=3600))])
async def change_password(body: ChangePasswordIn, request: Request, response: Response,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)) -> TokenOut:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    # Revoke every existing session: this password change logs out all devices.
    rows = await db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    await db.commit()
    return await _issue_session(db, user, response, request)


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict:
    profile = user.public_profile()
    profile["email"] = user.email
    return profile
