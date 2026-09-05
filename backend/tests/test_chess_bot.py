"""Chess vs Bot: profiles, fake UCI pool, unrated match flow, rematch."""

from __future__ import annotations

import os
import shutil
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Force fake engine + test env before app imports that read settings.
os.environ.setdefault("SECRET_KEY", "pytest-secret-key-not-for-production-use")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ["ENV"] = "test"
os.environ["CHESS_BOT_FAKE_ENGINE"] = "1"

from app.core.security import hash_password
from app.db.base import Base
from app.games.chess_bot import BotConfigError, resolve_persona, thinking_delay_seconds
from app.games.chess_engine import ChessEngine
from app.models.game import Game, GameSeat
from app.models.game_event import GameEvent
from app.models.user import User
from app.services import game_service
from app.services.bot_match import (
    apply_bot_action,
    create_bot_game,
    maybe_schedule_after_human_move,
    rematch_bot_game,
)
from app.services.stockfish_pool import EngineFailure, StockfishPool, reset_stockfish_pool


@pytest.fixture
async def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path}/bot.db"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    Game.__table__,
                    GameSeat.__table__,
                    GameEvent.__table__,
                ],
            )
        )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def fake_pool(monkeypatch):
    pool = reset_stockfish_pool(StockfishPool(fake=True, pool_size=1))
    monkeypatch.setattr("app.services.bot_match.get_stockfish_pool", lambda: pool)
    yield pool
    pool.close()


@pytest.fixture(autouse=True)
def _no_schedule(monkeypatch):
    monkeypatch.setattr("app.services.bot_match.schedule_bot_move", lambda *a, **k: None)
    monkeypatch.setattr("app.realtime.timers.start_timer", lambda *a, **k: None)


async def _user(db) -> User:
    u = User(
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        username=f"u_{uuid.uuid4().hex[:6]}",
        password_hash=hash_password("pw"),
        rating=1400,
    )
    db.add(u)
    await db.flush()
    return u


def test_persona_aliases_and_skills():
    assert resolve_persona("pawn").skill_level == 0
    assert resolve_persona("novice").persona_id == "pawn"
    assert resolve_persona("KING").skill_level == 20
    assert resolve_persona("master").tier == 6
    with pytest.raises(BotConfigError) as ei:
        resolve_persona("grandmaster")
    assert ei.value.code == "unknown_difficulty"
    delay = thinking_delay_seconds(resolve_persona("bishop"))
    assert 0.6 <= delay <= 1.3


def test_fake_pool_reuses_and_returns_legal_uci(fake_pool):
    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    u1 = fake_pool.choose_move(fen, skill_level=0)
    u2 = fake_pool.choose_move(fen, skill_level=20)
    assert u1 == u2  # deterministic fake
    assert len(u1) >= 4


@pytest.mark.asyncio
async def test_create_bot_game_unrated_metadata(db, fake_pool):
    user = await _user(db)
    game = await create_bot_game(db, user, difficulty="rook", player_color="white")
    assert game.status == "active"
    assert game.settings["opponent_type"] == "bot"
    assert game.settings["rated"] is False
    assert game.settings["player_color"] == "white"
    assert game.settings["bot"]["persona_id"] == "rook"
    assert game.settings["bot"]["skill_level"] == 11
    seats = list(await db.scalars(select(GameSeat).where(GameSeat.game_id == game.id)))
    by_seat = {s.seat: s for s in seats}
    assert by_seat[0].user_id == user.id
    assert by_seat[1].user_id is None
    view = await game_service.game_view(db, game, user)
    assert view["opponent_type"] == "bot"
    assert view["rated"] is False
    assert view["bot"]["display_name"] == "Rook Bot"
    assert "skill_level" not in view["bot"]
    assert view["your_seat"] == 0


@pytest.mark.asyncio
async def test_human_then_bot_move_same_pipeline(db, fake_pool):
    user = await _user(db)
    game = await create_bot_game(db, user, difficulty="pawn", player_color="white")
    message, events = await game_service.apply_action(
        db, game, user, "move", {"move": "e2e4"}
    )
    assert events[0]["type"] == "move_made"
    game = await game_service.get_game(db, game.id, for_update=True)
    assert game.last_seq >= 1
    # Bot replies via apply_bot_action (same pipeline)
    game = await game_service.get_game(db, game.id, for_update=True)
    msg, bot_events = await apply_bot_action(db, game, 1, "e7e5")
    assert bot_events[0]["payload"]["uci"] == "e7e5"
    events_rows = list(
        await db.scalars(select(GameEvent).where(GameEvent.game_id == game.id))
    )
    bot_ev = [e for e in events_rows if e.actor_user_id is None]
    assert bot_ev


@pytest.mark.asyncio
async def test_duplicate_bot_seq_does_not_double_move(db, fake_pool):
    user = await _user(db)
    game = await create_bot_game(db, user, difficulty="knight", player_color="black")
    # Bot is white — human has not moved; apply one bot move then refuse stale.
    game = await game_service.get_game(db, game.id, for_update=True)
    seq_before = game.last_seq
    await apply_bot_action(db, game, 0, "e2e4")
    game = await game_service.get_game(db, game.id, for_update=True)
    assert game.last_seq == seq_before + 1
    fen_after = game.state["fen"]
    # Second apply with wrong turn should raise
    with pytest.raises(Exception):
        await apply_bot_action(db, game, 0, "d2d4")
    game = await game_service.get_game(db, game.id)
    assert game.state["fen"] == fen_after


@pytest.mark.asyncio
async def test_bot_game_skips_ratings(db, fake_pool):
    user = await _user(db)
    old_rating = user.rating
    game = await create_bot_game(db, user, difficulty="pawn", player_color="white")
    # Fool's mate setup quickly via engine state injection
    game = await game_service.get_game(db, game.id, for_update=True)
    eng = ChessEngine()
    state = eng.init_state({}, [str(user.id), "bot"])
    for seat, mv in [(0, "f2f3"), (1, "e7e5"), (0, "g2g4")]:
        eng.apply_action(state, seat, "move", {"move": mv})
    game.state = state
    await db.commit()
    game = await game_service.get_game(db, game.id, for_update=True)
    await apply_bot_action(db, game, 1, "d8h4")
    game = await game_service.get_game(db, game.id)
    assert game.status == "finished"
    assert (game.result or {}).get("ratings") is None
    await db.refresh(user)
    assert user.rating == old_rating


@pytest.mark.asyncio
async def test_bot_rematch_same_persona(db, fake_pool):
    user = await _user(db)
    game = await create_bot_game(db, user, difficulty="queen", player_color="random")
    game.status = "finished"
    await db.commit()
    game = await game_service.get_game(db, game.id)
    new_game, invitees = await game_service.offer_rematch(db, game, user)
    assert invitees == []
    assert new_game.settings["bot"]["persona_id"] == "queen"
    assert new_game.status == "active"
    assert new_game.id != game.id


@pytest.mark.asyncio
async def test_extended_create_settings_mode_bot(db, fake_pool):
    user = await _user(db)
    game = await game_service.create_game(
        db,
        user,
        ChessEngine,
        {"mode": "bot", "difficulty": "bishop", "player_color": "black"},
    )
    assert game.settings["human_seat"] == 1
    assert game.settings["bot_seat"] == 0


def test_real_stockfish_integration_optional():
    path = os.environ.get("STOCKFISH_PATH", "/usr/local/bin/stockfish")
    binary = path if os.path.isfile(path) else shutil.which("stockfish")
    if not binary:
        pytest.skip("Stockfish binary not present")
    pool = StockfishPool(path=binary, pool_size=1, fake=False, move_timeout=2.0, hash_mb=16)
    try:
        fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        uci = pool.choose_move(fen, skill_level=0)
        assert isinstance(uci, str) and len(uci) >= 4
    finally:
        pool.close()
