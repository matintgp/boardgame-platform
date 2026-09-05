"""Chess vs Bot match lifecycle: create, schedule, apply Stockfish moves."""

from __future__ import annotations

import asyncio
import copy
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.base import utcnow
from app.games.chess_bot import (
    build_bot_settings,
    bot_seat_from_settings,
    human_seat_from_settings,
    is_bot_game,
    parse_player_color,
    public_bot_from_settings,
    resolve_color,
    resolve_persona,
    thinking_delay_seconds,
)
from app.games.chess_engine import ChessEngine
from app.games.registry import get_engine
from app.models.game import Game, GameSeat, GameStatus
from app.models.game_event import GameEvent
from app.models.user import User
from app.services import game_service
from app.services.stockfish_pool import EngineFailure, get_stockfish_pool

logger = logging.getLogger(__name__)

BOT_MOVE_MAX_RETRIES = 3


class BotCapacityError(ValueError):
    code = "bot_capacity"


async def count_active_bot_games(db: AsyncSession, user_id: uuid.UUID) -> int:
    rows = await db.scalars(
        select(Game)
        .join(GameSeat, GameSeat.game_id == Game.id)
        .where(
            GameSeat.user_id == user_id,
            Game.status == GameStatus.active.value,
            Game.game_type == "chess",
        )
    )
    n = 0
    for g in rows:
        if is_bot_game(g.settings):
            n += 1
    return n


async def create_bot_game(
    db: AsyncSession,
    user: User,
    *,
    difficulty: str,
    player_color: str | None = "random",
) -> Game:
    profile = resolve_persona(difficulty)
    preference = parse_player_color(player_color)
    resolved = resolve_color(preference)

    active = await count_active_bot_games(db, user.id)
    if active >= settings.chess_bot_max_concurrent_per_user:
        raise BotCapacityError("bot_capacity")

    bot_settings = build_bot_settings(profile, preference, resolved)
    human_seat = human_seat_from_settings(bot_settings)
    bot_seat = bot_seat_from_settings(bot_settings)

    engine = ChessEngine()
    # Seat labels: human uuid + literal "bot" (engine only needs ordered ids).
    seats_for_init = ["", ""]
    seats_for_init[human_seat] = str(user.id)
    seats_for_init[bot_seat] = "bot"

    game = Game(
        game_type=ChessEngine.game_id,
        status=GameStatus.active.value,
        max_players=2,
        settings=bot_settings,
        created_by=user.id,
        state=engine.init_state(bot_settings, seats_for_init),
        started_at=utcnow(),
    )
    db.add(game)
    await db.flush()
    db.add(GameSeat(game_id=game.id, user_id=user.id, seat=human_seat))
    db.add(GameSeat(game_id=game.id, user_id=None, seat=bot_seat))
    await db.commit()

    # Reload seats relationship.
    fresh = await game_service.get_game(db, game.id)
    assert fresh is not None
    from app.realtime.timers import start_timer

    start_timer(fresh.id)

    if bot_seat == engine.turn_seat(fresh.state or {}):
        delay = 0.0 if settings.env == "test" else thinking_delay_seconds(profile)
        schedule_bot_move(fresh.id, expected_seq=fresh.last_seq, delay_seconds=delay)
    return fresh


def schedule_bot_move(
    game_id: uuid.UUID,
    expected_seq: int,
    *,
    delay_seconds: float | None = None,
    attempt: int = 0,
) -> None:
    """Enqueue an idempotent bot move.

    Prefer the running API event loop (reliable Redis + DB). Fall back to Celery
    when called from a sync worker context with no loop.
    """
    delay = 0.0 if delay_seconds is None else max(0.0, float(delay_seconds))

    async def _inline() -> None:
        if delay:
            await asyncio.sleep(delay)
        await run_bot_move(game_id, expected_seq, attempt=attempt)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None and settings.env != "test":
        loop.create_task(_inline(), name=f"bot-move-{game_id}-{expected_seq}")
        return

    if settings.env != "test":
        try:
            from app.workers.tasks import compute_bot_move

            compute_bot_move.apply_async(
                args=[str(game_id), int(expected_seq), int(attempt)],
                countdown=delay,
            )
            return
        except Exception:
            logger.exception("Celery enqueue failed; no in-process loop either")
            return

    # Tests: always inline on the running pytest/asyncio loop.
    if loop is None:
        logger.warning(
            "schedule_bot_move: no event loop for game=%s seq=%s", game_id, expected_seq
        )
        return
    loop.create_task(_inline(), name=f"bot-move-{game_id}-{expected_seq}")


async def run_bot_move(
    game_id: uuid.UUID, expected_seq: int, *, attempt: int = 0
) -> dict[str, Any] | None:
    """Compute + apply a bot move if still valid. Returns broadcast message or None."""
    from app.db.session import SessionLocal
    from app.realtime import bus

    async with SessionLocal() as db:
        game = await game_service.get_game(db, game_id, for_update=True)
        if game is None or game.status != GameStatus.active.value:
            return None
        if not is_bot_game(game.settings):
            return None
        if game.last_seq != expected_seq:
            return None  # stale / duplicate

        settings_map = game.settings or {}
        bot_seat = bot_seat_from_settings(settings_map)
        engine = ChessEngine()
        state = copy.deepcopy(game.state or {})
        if engine.turn_seat(state) != bot_seat:
            return None
        if state.get("result"):
            return None

        profile = resolve_persona(
            (settings_map.get("bot") or {}).get("persona_id")
            or settings_map.get("difficulty")
            or "pawn"
        )

        pool = get_stockfish_pool()
        fen = state["fen"]
        try:
            uci = await asyncio.to_thread(pool.choose_move, fen, profile.skill_level)
        except EngineFailure as e:
            logger.warning("Bot engine failure game=%s attempt=%s: %s", game_id, attempt, e)
            if attempt + 1 < BOT_MOVE_MAX_RETRIES:
                await asyncio.sleep(0.4 * (attempt + 1))
                return await run_bot_move(game_id, expected_seq, attempt=attempt + 1)
            err = {
                "type": "bot_error",
                "room": game_service.game_room(game.id),
                "seq": game.last_seq,
                "payload": {
                    "code": "bot_engine_error",
                    "message": "Bot could not move. Retry.",
                    "retryable": True,
                    "seat": bot_seat,
                },
            }
            await bus.publish_internal(
                {
                    "room": game_service.game_room(game.id),
                    "per_seat": {},
                    "spectator": None,
                    "direct": {},
                    "broadcast": err,
                }
            )
            return None

        message, _ = await apply_bot_action(db, game, bot_seat, uci)
        await bus.publish_internal(message)
        return message


async def apply_bot_action(
    db: AsyncSession, game: Game, bot_seat: int, uci: str
) -> tuple[dict, list[dict]]:
    """Same apply_action pipeline as humans, without a User actor."""
    if game.status != GameStatus.active.value:
        raise ValueError("Game is not active")
    engine = get_engine(game.game_type)()
    state = copy.deepcopy(game.state or {})
    result = engine.apply_action(state, bot_seat, "move", {"move": uci})

    for ev in result.events:
        game.last_seq += 1
        db.add(
            GameEvent(
                game_id=game.id,
                seq=game.last_seq,
                actor_user_id=None,
                action_type=ev["type"],
                payload={**ev.get("payload", {}), "seat": ev.get("seat")},
            )
        )
    game.state = state
    if result.finished:
        game.status = GameStatus.finished.value
        game.result = result.result
        game.finished_at = utcnow()
        # Unrated — skip Elo.
    await db.commit()
    message = game_service.build_state_message(engine, game, state, result.events)
    return message, result.events


async def retry_bot_move(db: AsyncSession, game: Game, user: User) -> None:
    if not is_bot_game(game.settings):
        raise ValueError("Not a bot game")
    if game_service.seat_of(game, user.id) is None:
        raise PermissionError("Not a member")
    if game.status != GameStatus.active.value:
        raise ValueError("Game is not active")
    bot_seat = bot_seat_from_settings(game.settings or {})
    engine = ChessEngine()
    if engine.turn_seat(game.state or {}) != bot_seat:
        raise ValueError("Not bot turn")
    profile = resolve_persona(
        ((game.settings or {}).get("bot") or {}).get("persona_id")
        or (game.settings or {}).get("difficulty")
        or "pawn"
    )
    schedule_bot_move(
        game.id,
        expected_seq=game.last_seq,
        delay_seconds=thinking_delay_seconds(profile),
        attempt=0,
    )


async def rematch_bot_game(db: AsyncSession, game: Game, user: User) -> Game:
    if not is_bot_game(game.settings):
        raise ValueError("Not a bot game")
    if game_service.seat_of(game, user.id) is None:
        raise PermissionError("Not a member")
    if game.status != GameStatus.finished.value:
        raise ValueError("Game is not finished")
    settings_map = game.settings or {}
    difficulty = (
        (settings_map.get("bot") or {}).get("persona_id")
        or settings_map.get("difficulty")
        or "pawn"
    )
    color_pref = settings_map.get("color_preference") or "random"
    return await create_bot_game(
        db, user, difficulty=str(difficulty), player_color=str(color_pref)
    )


def maybe_schedule_after_human_move(game: Game) -> None:
    if game.status != GameStatus.active.value or not is_bot_game(game.settings):
        return
    bot_seat = bot_seat_from_settings(game.settings or {})
    engine = ChessEngine()
    state = game.state or {}
    if state.get("result"):
        return
    if engine.turn_seat(state) != bot_seat:
        return
    profile = resolve_persona(
        ((game.settings or {}).get("bot") or {}).get("persona_id")
        or (game.settings or {}).get("difficulty")
        or "pawn"
    )
    delay = 0.0 if settings.env == "test" else thinking_delay_seconds(profile)
    schedule_bot_move(game.id, expected_seq=game.last_seq, delay_seconds=delay)


def bot_game_view_fields(game: Game) -> dict[str, Any]:
    settings_map = game.settings or {}
    out: dict[str, Any] = {
        "rated": bool(settings_map.get("rated", True)) and not is_bot_game(settings_map),
        "opponent_type": "bot" if is_bot_game(settings_map) else "human",
    }
    if is_bot_game(settings_map):
        out["player_color"] = settings_map.get("player_color")
        out["color_preference"] = settings_map.get("color_preference")
        out["bot"] = public_bot_from_settings(settings_map)
    return out
