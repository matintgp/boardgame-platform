"""Server-side per-game timer loop for chess.

Every active chess game gets an asyncio task ticking once per second:
- ticks the active player's clock (10-minute total); 0:00 => timeout loss
- if the active player is OFFLINE: pauses the clock and starts a 60s
  reconnect grace; grace expired => loss by abandonment
- if the active player is ONLINE but hasn't moved within 60s => the site
  plays a random legal move for them

Timers start when a game becomes active and are (re)started lazily when a
player syncs into an active game (e.g. after a backend restart).
"""

import asyncio
import copy
import logging
import time
import uuid

from app.db.session import SessionLocal
from app.services import game_service

logger = logging.getLogger(__name__)

TICK_SECONDS = 1.0
MOVE_LIMIT_SECONDS = 60
OFFLINE_GRACE_SECONDS = 60

_tasks: dict[uuid.UUID, asyncio.Task] = {}


def start_timer(game_id: uuid.UUID) -> None:
    if game_id in _tasks:
        return
    _tasks[game_id] = asyncio.create_task(_loop(game_id))


def stop_timer(game_id: uuid.UUID) -> None:
    task = _tasks.pop(game_id, None)
    if task is not None:
        task.cancel()


async def _loop(game_id: uuid.UUID) -> None:
    try:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            keep = await _tick(game_id)
            if not keep:
                stop_timer(game_id)
                return
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("timer loop crashed for game %s", game_id)
        stop_timer(game_id)


async def _tick(gid: uuid.UUID) -> bool:
    """One tick. Returns False when the timer should stop."""
    from app.games.chess_engine import ChessEngine
    from app.games.registry import get_engine
    from app.realtime import bus
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
        online = hub.user_online(seat_obj.user_id)
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
