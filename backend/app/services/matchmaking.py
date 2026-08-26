"""Quick-match matchmaking queue (per game type) backed by a Redis sorted set.

Joining is idempotent and poll-friendly: the client POSTs the same endpoint
every few seconds; when a pair forms, BOTH players get {"status": "matched"}.
"""

import time
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.games.base import BaseEngine
from app.models.game import Game, GameSeat, GameStatus
from app.models.user import User
from app.realtime.bus import get_redis

QUEUE_TTL_SECONDS = 120  # entries older than this are considered stale


def _key(game_type: str) -> str:
    return f"mm:queue:{game_type}"


def _match_key(user_id: uuid.UUID) -> str:
    return f"mm:match:{user_id}"


async def _create_match(db: AsyncSession, a: User, b: User, engine_cls: type[BaseEngine]) -> Game:
    """Create a fully-seated, immediately-started game. `a` plays seat 0."""
    engine = engine_cls()
    game = Game(
        game_type=engine_cls.game_id,
        status=GameStatus.waiting.value,
        max_players=engine_cls.max_players,
        settings={},
        created_by=a.id,
    )
    db.add(game)
    await db.flush()
    db.add(GameSeat(game_id=game.id, user_id=a.id, seat=0))
    db.add(GameSeat(game_id=game.id, user_id=b.id, seat=1))
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
    redis = get_redis()
    key = _key(engine_cls.game_id)
    now = time.time()

    # Already matched by an earlier pairing? (we may have been popped by them)
    matched = await redis.get(_match_key(user.id))
    if matched:
        await redis.delete(_match_key(user.id))
        return {"status": "matched", "game_id": matched}

    # Pairing must be atomic across concurrent pollers.
    got_lock = await redis.set("mm:lock", str(user.id), nx=True, ex=3)
    if not got_lock:
        return {"status": "waiting"}

    try:
        await redis.zremrangebyscore(key, 0, now - QUEUE_TTL_SECONDS)
        opponent_id: str | None = None
        members = await redis.zrange(key, 0, -1)
        for member in members:
            if member != str(user.id):
                opponent_id = member
                break

        if opponent_id is None:
            await redis.zadd(key, {str(user.id): now})
            return {"status": "waiting"}

        await redis.zrem(key, opponent_id)
        opp = await db.scalar(select(User).where(User.id == uuid.UUID(opponent_id)))
        if opp is None or not opp.is_active:
            return {"status": "waiting"}

        game = await _create_match(db, opp, user, engine_cls)
        # Leave a match ticket for the opponent's next poll.
        await redis.set(_match_key(opp.id), str(game.id), ex=60)
        return {"status": "matched", "game_id": str(game.id)}
    finally:
        await redis.delete("mm:lock")


async def leave_queue(user_id: uuid.UUID, game_type: str) -> None:
    redis = get_redis()
    await redis.zrem(_key(game_type), str(user_id))
    await redis.delete(_match_key(user_id))
