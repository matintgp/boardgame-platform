"""Matchmaking waits until engine.min_players distinct users are queued."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.base import Base
from app.games.chess_engine import ChessEngine
from app.games.mafia_engine import MafiaEngine
from app.models.game import Game, GameSeat
from app.models.user import User
from app.services import matchmaking


@pytest.fixture
async def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/mm.db"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c, tables=[User.__table__, Game.__table__, GameSeat.__table__]
            )
        )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def _users(db, n: int) -> list[User]:
    users = []
    for i in range(n):
        u = User(
            email=f"u{i}-{uuid.uuid4().hex[:8]}@example.com",
            username=f"user{i}_{uuid.uuid4().hex[:6]}",
            password_hash=hash_password("pw"),
        )
        db.add(u)
        users.append(u)
    await db.flush()
    return users


@pytest.mark.asyncio
async def test_mafia_waits_at_two_matches_at_four(db, fake_redis):
    users = await _users(db, 4)
    engine = MafiaEngine

    r1 = await matchmaking.join_queue(db, users[0], engine)
    r2 = await matchmaking.join_queue(db, users[1], engine)
    assert r1["status"] == "waiting"
    assert r2["status"] == "waiting"

    queued = await fake_redis.zrange("mm:queue:mafia", 0, -1)
    assert set(queued) == {str(users[0].id), str(users[1].id)}

    r3 = await matchmaking.join_queue(db, users[2], engine)
    assert r3["status"] == "waiting"

    r4 = await matchmaking.join_queue(db, users[3], engine)
    assert r4["status"] == "matched"
    game_id = r4["game_id"]
    assert game_id

    from sqlalchemy import select

    game = await db.scalar(select(Game).where(Game.id == uuid.UUID(game_id)))
    assert game is not None
    assert game.status == "active"
    assert game.game_type == "mafia"
    seats = list(await db.scalars(select(GameSeat).where(GameSeat.game_id == game.id)))
    assert {s.seat for s in seats} == {0, 1, 2, 3}
    assert {s.user_id for s in seats} == {u.id for u in users}
    assert game.state is not None

    # Tickets for everyone except the caller (users[3]).
    assert await fake_redis.get(f"mm:match:{users[0].id}") == game_id
    assert await fake_redis.get(f"mm:match:{users[1].id}") == game_id
    assert await fake_redis.get(f"mm:match:{users[2].id}") == game_id
    assert await fake_redis.get(f"mm:match:{users[3].id}") is None

    # Queue emptied; earlier players pick up the ticket on their next poll.
    assert await fake_redis.zrange("mm:queue:mafia", 0, -1) == []
    picked = await matchmaking.join_queue(db, users[0], engine)
    assert picked == {"status": "matched", "game_id": game_id}


@pytest.mark.asyncio
async def test_chess_matches_at_two(db, fake_redis, monkeypatch):
    monkeypatch.setattr("app.realtime.timers.start_timer", lambda gid: None)
    a, b = await _users(db, 2)
    r1 = await matchmaking.join_queue(db, a, ChessEngine)
    assert r1["status"] == "waiting"
    r2 = await matchmaking.join_queue(db, b, ChessEngine)
    assert r2["status"] == "matched"
    from sqlalchemy import select

    game = await db.scalar(select(Game).where(Game.id == uuid.UUID(r2["game_id"])))
    seats = list(await db.scalars(select(GameSeat).where(GameSeat.game_id == game.id)))
    assert {s.seat for s in seats} == {0, 1}


@pytest.mark.asyncio
async def test_lock_is_per_game_type(db, fake_redis, monkeypatch):
    """A held global mm:lock must not block a different game type."""
    monkeypatch.setattr("app.realtime.timers.start_timer", lambda gid: None)
    await fake_redis.set("mm:lock", "stale-global", nx=True, ex=30)
    a, b = await _users(db, 2)
    r1 = await matchmaking.join_queue(db, a, ChessEngine)
    r2 = await matchmaking.join_queue(db, b, ChessEngine)
    assert r1["status"] == "waiting"
    assert r2["status"] == "matched"
