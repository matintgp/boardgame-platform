"""Quick-match matchmaking queue (per game type) backed by a Redis sorted set.

Joining is idempotent and poll-friendly: the client POSTs the same endpoint
every few seconds; when a table forms, ALL seated players get {"status": "matched"}.
"""

import time
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.games.base import BaseEngine
from app.models.game import Game, GameSeat, GameStatus
from app.models.user import User
from app.realtime import bus

QUEUE_TTL_SECONDS = 120  # entries older than this are considered stale


def _key(game_type: str) -> str:
    return f"mm:queue:{game_type}"


def _match_key(user_id: uuid.UUID) -> str:
    return f"mm:match:{user_id}"


def _lock_key(game_type: str) -> str:
    return f"mm:lock:{game_type}"


async def _create_match(
    db: AsyncSession, players: list[User], engine_cls: type[BaseEngine]
) -> Game:
    """Create a fully-seated, immediately-started game. `players[i]` sits seat i."""
    engine = engine_cls()
    game = Game(
        game_type=engine_cls.game_id,
        status=GameStatus.waiting.value,
        max_players=engine_cls.max_players,
        settings={},
        created_by=players[0].id,
    )
    db.add(game)
    await db.flush()
    for i, player in enumerate(players):
        db.add(GameSeat(game_id=game.id, user_id=player.id, seat=i))
    await db.flush()

    seats = sorted(
        await db.scalars(select(GameSeat).where(GameSeat.game_id == game.id)),
        key=lambda s: s.seat,
    )
    ordered_ids = [str(s.user_id) for s in seats]
    game.state = engine.init_state({}, ordered_ids)
    game.status = GameStatus.active.value
    game.started_at = utcnow()
    await db.commit()
    if engine_cls.game_id == "chess":
        from app.realtime.timers import start_timer

        start_timer(game.id)
    return game


async def join_queue(
    db: AsyncSession, user: User, engine_cls: type[BaseEngine]
) -> dict:
    redis = bus.get_redis()
    key = _key(engine_cls.game_id)
    lock_key = _lock_key(engine_cls.game_id)
    now = time.time()
    caller_id = str(user.id)
    needed = engine_cls.min_players

    # Already matched by an earlier pairing? (we may have been popped by them)
    matched = await redis.get(_match_key(user.id))
    if matched:
        await redis.delete(_match_key(user.id))
        return {"status": "matched", "game_id": matched}

    # Pairing must be atomic across concurrent pollers of the same game type.
    got_lock = await redis.set(lock_key, caller_id, nx=True, ex=3)
    if not got_lock:
        return {"status": "waiting"}

    try:
        await redis.zremrangebyscore(key, 0, now - QUEUE_TTL_SECONDS)
        members = await redis.zrange(key, 0, -1)

        others: list[User] = []
        for member in members:
            if member == caller_id:
                continue
            opp = await db.scalar(select(User).where(User.id == uuid.UUID(member)))
            if opp is None or not opp.is_active:
                await redis.zrem(key, member)
                continue
            others.append(opp)
            if len(others) >= needed - 1:
                break

        if len(others) < needed - 1:
            await redis.zadd(key, {caller_id: now})
            return {"status": "waiting"}

        players = [*others[: needed - 1], user]
        await redis.zrem(key, *[str(p.id) for p in players])

        game = await _create_match(db, players, engine_cls)
        # Leave a match ticket for everyone except the caller.
        for p in players:
            if p.id != user.id:
                await redis.set(_match_key(p.id), str(game.id), ex=60)
        return {"status": "matched", "game_id": str(game.id)}
    finally:
        await redis.delete(lock_key)


async def leave_queue(user_id: uuid.UUID, game_type: str) -> None:
    redis = bus.get_redis()
    await redis.zrem(_key(game_type), str(user_id))
    await redis.delete(_match_key(user_id))
