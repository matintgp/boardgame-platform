"""Server-side per-game timer loop for chess.

Every active chess game is ticked once per second by at most ONE process
(Redis lock). Ticks:
- settle the active player's clock (10-minute total); 0:00 => timeout loss
- if the active player is OFFLINE: pause the clock and start a 60s
  reconnect grace; grace expired => loss by abandonment
- if the active player is ONLINE but hasn't moved within 60s => the site
  plays a random legal move for them

Presence is Redis-backed so any worker's tick sees the same online set.

Timers start when a game becomes active, are (re)started lazily when a
player syncs into an active game, and a supervisor scans active chess
games so a newly-started game (or a backend restart) is picked up by
every worker. The Redis lock decides who actually ticks.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import time
import uuid

from app.db.session import SessionLocal
from app.realtime import bus
from app.services import game_service

logger = logging.getLogger(__name__)

TICK_SECONDS = 1.0
MOVE_LIMIT_SECONDS = 60
OFFLINE_GRACE_SECONDS = 60
LOCK_TTL_SECONDS = 5
SUPERVISOR_INTERVAL_SECONDS = 3.0
LOCK_KEY = "timer:lock:{game_id}"

_tasks: dict[uuid.UUID, asyncio.Task] = {}
_lock_tokens: dict[uuid.UUID, str] = {}
_supervisor_task: asyncio.Task | None = None


def _lock_key(game_id: uuid.UUID) -> str:
    return LOCK_KEY.format(game_id=game_id)


def _token_for(game_id: uuid.UUID) -> str:
    tok = _lock_tokens.get(game_id)
    if tok is None:
        tok = uuid.uuid4().hex
        _lock_tokens[game_id] = tok
    return tok


async def acquire_timer_lock(game_id: uuid.UUID, token: str) -> bool:
    """Try to become (or remain) the unique ticker for this game."""
    redis = bus.get_redis()
    key = _lock_key(game_id)
    got = await redis.set(key, token, nx=True, ex=LOCK_TTL_SECONDS)
    if got:
        return True
    current = await redis.get(key)
    if current == token:
        await redis.expire(key, LOCK_TTL_SECONDS)
        return True
    return False


async def release_timer_lock(game_id: uuid.UUID, token: str) -> None:
    redis = bus.get_redis()
    key = _lock_key(game_id)
    current = await redis.get(key)
    if current == token:
        await redis.delete(key)


def start_timer(game_id: uuid.UUID) -> None:
    existing = _tasks.get(game_id)
    if existing is not None and not existing.done():
        return
    _tasks[game_id] = asyncio.create_task(_loop(game_id), name=f"chess-timer-{game_id}")


def stop_timer(game_id: uuid.UUID) -> None:
    task = _tasks.pop(game_id, None)
    _lock_tokens.pop(game_id, None)
    if task is not None and not task.done():
        task.cancel()


async def resume_active_timers() -> None:
    """Start a local loop for every active chess game (idempotent per process)."""
    from sqlalchemy import select

    from app.models.game import Game

    try:
        async with SessionLocal() as db:
            ids = (
                await db.scalars(
                    select(Game.id).where(
                        Game.status == "active",
                        Game.game_type == "chess",
                    )
                )
            ).all()
    except Exception:
        logger.exception("failed to scan active chess games for timers")
        return
    for gid in ids:
        start_timer(gid)


def start_supervisor() -> None:
    global _supervisor_task
    if _supervisor_task is not None and not _supervisor_task.done():
        return
    _supervisor_task = asyncio.create_task(_supervisor(), name="chess-timer-supervisor")


def stop_supervisor() -> None:
    global _supervisor_task
    if _supervisor_task is not None:
        _supervisor_task.cancel()
        _supervisor_task = None
    for gid in list(_tasks):
        stop_timer(gid)


async def _supervisor() -> None:
    while True:
        try:
            await resume_active_timers()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("timer supervisor scan failed")
        await asyncio.sleep(SUPERVISOR_INTERVAL_SECONDS)


async def _loop(game_id: uuid.UUID) -> None:
    token = _token_for(game_id)
    try:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            if not await acquire_timer_lock(game_id, token):
                continue
            keep = await _tick(game_id)
            if not keep:
                return
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("timer loop crashed for game %s", game_id)
    finally:
        try:
            await release_timer_lock(game_id, token)
        except Exception:
            pass
        _tasks.pop(game_id, None)
        _lock_tokens.pop(game_id, None)


async def _tick(gid: uuid.UUID) -> bool:
    """One tick. Returns False when the timer should stop."""
    from app.games.registry import get_engine
    from app.realtime.hub import hub

    async with SessionLocal() as db:
        game = await game_service.get_game(db, gid, for_update=True)
        if game is None or game.status != "active" or game.game_type != "chess":
            return False
        engine = get_engine("chess")()
        state = copy.deepcopy(game.state or {})
        if not state.get("clocks"):
            return False  # legacy game without clocks

        seat_to_move = engine.turn_seat(state)
        seat_obj = next((s for s in game.seats if s.seat == seat_to_move), None)
        if seat_obj is None:
            return False
        online = await hub.user_online(seat_obj.user_id)
        now = time.time()
        changed = False

        if state.get("paused"):
            if online:
                # resumed via the WS sync path (it clears the pause)
                pass
            elif now - state["paused"]["since"] >= OFFLINE_GRACE_SECONDS:
                winner = 1 - seat_to_move
                result = {"reason": "abandoned", "winner_seat": winner}
                state["result"] = result
                game.state = state
                game.status = "finished"
                game.result = result
                game.finished_at = game_service.utcnow()
                await game_service._apply_ratings(db, game, result)
                await db.commit()
                await bus.publish_internal(
                    game_service.build_state_message(engine, game, state,
                                                     [{"type": "game_over", "seat": None, "payload": result}])
                )
                return False
            # else: keep waiting, no clock tick while paused
        else:
            if not online:
                state["paused"] = {"seat": seat_to_move, "since": now}
                state["turn_started_at"] = now  # freeze the clock reference
                changed = True
            else:
                # settle the clock by this tick's delta
                turn = str(seat_to_move)
                state["clocks"][turn] = state["clocks"].get(turn, 600.0) - TICK_SECONDS
                timeout = False
                if state["clocks"][turn] <= 0:
                    state["clocks"][turn] = 0
                    timeout = True
                if timeout:
                    result = {"reason": "timeout", "winner_seat": 1 - seat_to_move}
                    state["result"] = result
                    game.state = state
                    game.status = "finished"
                    game.result = result
                    game.finished_at = game_service.utcnow()
                    await game_service._apply_ratings(db, game, result)
                    await db.commit()
                    await bus.publish_internal(
                        game_service.build_state_message(
                            engine, game, state,
                            [{"type": "game_over", "seat": None, "payload": result}])
                    )
                    return False
                changed = True

                # auto-move: player online but thinking for too long
                if now - state.get("turn_started_at", now) >= MOVE_LIMIT_SECONDS:
                    apply_res = engine.random_move(state)
                    game.last_seq += len(apply_res.events)
                    for ev in apply_res.events:
                        from app.models.game_event import GameEvent

                        db.add(GameEvent(
                            game_id=game.id, seq=game.last_seq,
                            actor_user_id=seat_obj.user_id,
                            action_type=ev["type"],
                            payload={**ev.get("payload", {}), "seat": ev.get("seat")},
                        ))
                    if apply_res.finished:
                        game.status = "finished"
                        game.result = apply_res.result
                        game.finished_at = game_service.utcnow()
                        await game_service._apply_ratings(db, game, apply_res.result or {})
                    changed = True

        if changed:
            game.state = state
            await db.commit()
            await bus.publish_internal(
                game_service.build_state_message(engine, game, state, [])
            )
        return True
