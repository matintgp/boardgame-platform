"""Rematch opens a new waiting table; former opponents join themselves."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.base import Base
from app.games.chess_engine import ChessEngine
from app.games.mafia_engine import MafiaEngine
from app.models.game import Game, GameSeat
from app.models.user import User
from app.services import game_service


@pytest.fixture
async def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/rematch.db"
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


async def _finish_with_seats(db, host: User, others: list[User], engine_cls) -> Game:
    game = await game_service.create_game(db, host, engine_cls, {})
    # create_game already seated the host at 0 and committed; don't lazy-load seats.
    for i, other in enumerate(others, start=1):
        db.add(GameSeat(game_id=game.id, user_id=other.id, seat=i))
    game.status = "finished"
    await db.commit()
    loaded = await game_service.get_game(db, game.id)
    assert loaded is not None
    return loaded


@pytest.mark.asyncio
async def test_rematch_seats_only_the_requester(db):
    host, opp = await _users(db, 2)
    finished = await _finish_with_seats(db, host, [opp], ChessEngine)

    new_game, invitees = await game_service.offer_rematch(db, finished, host)

    assert invitees == [opp.id]
    assert new_game.status == "waiting"
    assert new_game.game_type == "chess"
    seats = list(await db.scalars(select(GameSeat).where(GameSeat.game_id == new_game.id)))
    assert [s.user_id for s in seats] == [host.id]


@pytest.mark.asyncio
async def test_rematch_opponent_joins_after_consent(db):
    host, opp = await _users(db, 2)
    finished = await _finish_with_seats(db, host, [opp], ChessEngine)
    new_game, _invitees = await game_service.offer_rematch(db, finished, host)

    fresh = await game_service.get_game(db, new_game.id, for_update=True)
    payload = await game_service.join_game(db, fresh, opp)
    assert {p["user"]["id"] for p in payload["players"]} == {str(host.id), str(opp.id)}


@pytest.mark.asyncio
async def test_rematch_rejects_unfinished_game(db):
    host, opp = await _users(db, 2)
    waiting = await game_service.create_game(db, host, ChessEngine, {})
    db.add(GameSeat(game_id=waiting.id, user_id=opp.id, seat=1))
    await db.commit()
    waiting = await game_service.get_game(db, waiting.id)
    with pytest.raises(ValueError, match="Game is not finished"):
        await game_service.offer_rematch(db, waiting, host)


@pytest.mark.asyncio
async def test_rematch_invites_every_former_seat(db):
    users = await _users(db, 4)
    finished = await _finish_with_seats(db, users[0], users[1:], MafiaEngine)

    new_game, invitees = await game_service.offer_rematch(db, finished, users[0])

    assert set(invitees) == {u.id for u in users[1:]}
    seats = list(await db.scalars(select(GameSeat).where(GameSeat.game_id == new_game.id)))
    assert [s.user_id for s in seats] == [users[0].id]


@pytest.mark.asyncio
async def test_rematch_rejects_non_member(db):
    host, opp, stranger = await _users(db, 3)
    finished = await _finish_with_seats(db, host, [opp], ChessEngine)
    with pytest.raises(PermissionError, match="Not a member"):
        await game_service.offer_rematch(db, finished, stranger)
