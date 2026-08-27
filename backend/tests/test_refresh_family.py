"""Refresh-token rotation: reuse of a consumed token revokes the family."""

from __future__ import annotations

import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.responses import Response

from app.api.routes.auth import REFRESH_COOKIE, _issue_session, _sha256, refresh
from app.core.security import hash_password
from app.db.base import Base, utcnow
from app.models.refresh_token import RefreshToken
from app.models.user import User


@pytest.fixture
async def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/auth.db"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c, tables=[User.__table__, RefreshToken.__table__]
            )
        )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def _user(db) -> User:
    user = User(
        email="alice@example.com",
        username="alice",
        password_hash=hash_password("correct-horse"),
    )
    db.add(user)
    await db.flush()
    return user


def _request(raw: str):
    return SimpleNamespace(
        cookies={REFRESH_COOKIE: raw},
        headers={"user-agent": "pytest"},
    )


@pytest.mark.asyncio
async def test_refresh_reuse_revokes_family(db):
    from sqlalchemy import select

    user = await _user(db)
    family = uuid.uuid4()
    raw_old = "old-refresh-token-value"
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family,
            token_hash=_sha256(raw_old),
            expires_at=utcnow() + timedelta(days=30),
        )
    )
    await db.commit()

    resp1 = Response()
    out = await refresh(_request(raw_old), resp1, db)
    assert out.access_token

    # Rotation issued a new token in the same family; old one is revoked.
    rows = list(
        (await db.scalars(select(RefreshToken).where(RefreshToken.family_id == family))).all()
    )
    assert len(rows) == 2
    assert sum(1 for r in rows if r.revoked_at is None) == 1

    # Reuse of the consumed token revokes the whole family (including the new one).
    resp2 = Response()
    with pytest.raises(HTTPException) as ei:
        await refresh(_request(raw_old), resp2, db)
    assert ei.value.status_code == 401

    rows = list(
        (await db.scalars(select(RefreshToken).where(RefreshToken.family_id == family))).all()
    )
    assert rows
    assert all(r.revoked_at is not None for r in rows)


@pytest.mark.asyncio
async def test_refresh_reuse_does_not_revoke_other_families(db):
    from sqlalchemy import select

    user = await _user(db)
    fam_a, fam_b = uuid.uuid4(), uuid.uuid4()
    raw_a, raw_b = "token-a", "token-b"
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=fam_a,
            token_hash=_sha256(raw_a),
            expires_at=utcnow() + timedelta(days=30),
        )
    )
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=fam_b,
            token_hash=_sha256(raw_b),
            expires_at=utcnow() + timedelta(days=30),
        )
    )
    await db.commit()

    # Rotate A, then reuse A's old token.
    await refresh(_request(raw_a), Response(), db)
    with pytest.raises(HTTPException):
        await refresh(_request(raw_a), Response(), db)

    b = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _sha256(raw_b))
    )
    assert b is not None
    assert b.revoked_at is None
    # B can still rotate.
    out = await refresh(_request(raw_b), Response(), db)
    assert out.access_token


@pytest.mark.asyncio
async def test_unknown_refresh_token_is_401(db):
    await _user(db)
    with pytest.raises(HTTPException) as ei:
        await refresh(_request("never-issued"), Response(), db)
    assert ei.value.status_code == 401


@pytest.mark.asyncio
async def test_issue_session_starts_new_family(db):
    from sqlalchemy import select

    user = await _user(db)
    req = SimpleNamespace(cookies={}, headers={"user-agent": "pytest"})
    await _issue_session(db, user, Response(), req)
    await _issue_session(db, user, Response(), req)
    families = {
        r.family_id
        for r in (await db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id))).all()
    }
    assert len(families) == 2
