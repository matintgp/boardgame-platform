from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.limiter import rate_limit
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User

MAX_WS_MESSAGE_BYTES = 16 * 1024


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def user_from_access_token(token: str) -> User | None:
    """Resolve a user from a raw access JWT. Returns None if invalid."""
    try:
        user_id = decode_access_token(token)
    except PyJWTError:
        return None
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            return None
        # Detach so the instance survives after the session closes.
        await session.refresh(user)
        session.expunge(user)
        return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    token = auth.removeprefix("Bearer ").strip()
    try:
        user_id = decode_access_token(token)
    except PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from None
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or disabled")
    return user


def require_rate_limit(scope: str, limit: int, window_seconds: int):
    """Dependency factory: Redis sliding-window rate limiter keyed by client IP."""

    async def _dependency(request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        ok = await rate_limit(f"rl:{scope}:{ip}", limit, window_seconds)
        if not ok:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")

    return _dependency
