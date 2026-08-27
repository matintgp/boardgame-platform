"""Game/lobby business logic. All state changes go through here so that event
logging, snapshots and broadcasting stay consistent."""

import copy
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.base import utcnow
from app.games.base import IllegalAction, BaseEngine
from app.games.registry import get_engine
from app.models.game import Game, GameSeat, GameStatus
from app.models.game_event import GameEvent
from app.models.user import User
from app.realtime import bus
from app.services.rating import elo_update


def game_room(game_id: uuid.UUID) -> str:
    return f"game:{game_id}"


async def create_game(db: AsyncSession, user: User, engine_cls: type[BaseEngine], config: dict) -> Game:
    extra = engine_cls().validate_config(config)
    game = Game(
        game_type=engine_cls.game_id,
        status=GameStatus.waiting.value,
        max_players=engine_cls.max_players,
        settings=extra,
        created_by=user.id,
    )
    db.add(game)
    await db.flush()
    db.add(GameSeat(game_id=game.id, user_id=user.id, seat=0))
    await db.commit()
    return game


async def get_game(db: AsyncSession, game_id: uuid.UUID, for_update: bool = False) -> Game | None:
    """for_update=True locks the row: use for any read-modify-write (join/start/action)
    to prevent seat/seq races between concurrent requests."""
    q = select(Game).where(Game.id == game_id).options(selectinload(Game.seats))
    if for_update:
        q = q.with_for_update()
    return await db.scalar(q)


def seat_of(game: Game, user_id: uuid.UUID) -> int | None:
    for s in game.seats:
        if s.user_id == user_id:
            return s.seat
    return None


def lobby_payload(game: Game, users_by_id: dict[uuid.UUID, User]) -> dict:
    return {
        "id": str(game.id),
        "game_type": game.game_type,
        "status": game.status,
        "max_players": game.max_players,
        "created_by": str(game.created_by),
        "players": [
            {
                "seat": s.seat,
                "user": users_by_id[s.user_id].public_profile() if s.user_id in users_by_id else {"id": str(s.user_id)},
            }
            for s in sorted(game.seats, key=lambda x: x.seat)
        ],
    }


async def game_view(db: AsyncSession, game: Game, user: User | None = None) -> dict:
    """Full game info for the game page (lobby roster + viewer-specific fields)."""
    users = await _load_users(db, game)
    payload = lobby_payload(game, users)
    payload["result"] = game.result
    if user is not None:
        payload["your_seat"] = seat_of(game, user.id)
        payload["is_host"] = user.id == game.created_by
    if game.state:
        engine = get_engine(game.game_type)()
        viewer_seat = seat_of(game, user.id) if user is not None else None
        payload["state"] = engine.visible_state(game.state, viewer_seat)
    return payload


async def join_game(db: AsyncSession, game: Game, user: User) -> dict:
    """Join a waiting lobby. Returns broadcast payload on success."""
    if game.status != GameStatus.waiting.value:
        raise ValueError("Game already started")
    if seat_of(game, user.id) is not None:
        raise ValueError("Already joined")
    if len(game.seats) >= game.max_players:
        raise ValueError("Lobby is full")

    used = {s.seat for s in game.seats}
    seat = next(i for i in range(game.max_players) if i not in used)
    db.add(GameSeat(game_id=game.id, user_id=user.id, seat=seat))
    await db.commit()

    # The seats relationship is stale after commit (new row added in this
    # session) - re-load it before building the broadcast payload.
    fresh_seats = await db.scalars(select(GameSeat).where(GameSeat.game_id == game.id))
    game.seats = list(fresh_seats)

    users = await _load_users(db, game)
    return lobby_payload(game, users)


async def start_game(db: AsyncSession, game: Game, actor: User) -> dict:
    if game.status != GameStatus.waiting.value:
        raise ValueError("Game already started")
    if actor.id != game.created_by:
        raise PermissionError("Only the host can start")
    engine_cls = get_engine(game.game_type)
    seats = sorted(game.seats, key=lambda s: s.seat)
    if len(seats) < engine_cls.min_players:
        raise ValueError("Not enough players")

    ordered_ids = [str(s.user_id) for s in seats]
    state = engine_cls().init_state(game.settings, ordered_ids)
    game.state = state
    game.status = GameStatus.active.value
    game.started_at = utcnow()
    await db.commit()

    users = await _load_users(db, game)
    return started_payload(engine_cls(), game, users)


def started_payload(engine: BaseEngine, game: Game, users_by_id: dict) -> dict:
    per_seat = {}
    for s in game.seats:
        per_seat[str(s.seat)] = {
            "type": "started",
            "room": game_room(game.id),
            "seq": 0,
            "payload": {
                **lobby_payload(game, users_by_id),
                "state": engine.visible_state(game.state or {}, s.seat),
            },
        }
    return {
        "room": game_room(game.id),
        "per_seat": per_seat,
        "spectator": {
            "type": "started",
            "room": game_room(game.id),
            "seq": 0,
            "payload": {
                **lobby_payload(game, users_by_id),
                "state": engine.visible_state(game.state or {}, None),
            },
        },
    }


# Night actions and day votes are simultaneous + secret. Broadcasting the
# actor seat (or the event itself) to the rest of the table leaks role.
SECRET_EVENT_TYPES = frozenset({
    "night_action",
    "vote_cast",
    "night_kill",
    "gavel",
    "conspiracy_take",
})


def events_for_viewer(events: list[dict], viewer_seat: int | None) -> list[dict]:
    """Drop secret events the viewer is not the actor of."""
    out: list[dict] = []
    for ev in events:
        if ev.get("type") in SECRET_EVENT_TYPES:
            if viewer_seat is None or ev.get("seat") != viewer_seat:
                continue
        out.append(ev)
    return out


def event_visible_to(ev: GameEvent, viewer_seat: int | None) -> bool:
    if ev.action_type not in SECRET_EVENT_TYPES:
        return True
    return viewer_seat is not None and ev.payload.get("seat") == viewer_seat


def build_state_message(
    engine, game: Game, state: dict, events: list[dict], seq: int | None = None
) -> dict:
    """Per-seat visible snapshots broadcast (shared by moves and the timer loop)."""
    last_seq = seq if seq is not None else game.last_seq
    per_seat = {}
    for s in game.seats:
        vis = engine.visible_state(state, s.seat)
        per_seat[str(s.seat)] = {
            "type": "state",
            "room": game_room(game.id),
            "seq": last_seq,
            "payload": {"events": events_for_viewer(events, s.seat), "state": vis},
        }
    return {
        "room": game_room(game.id),
        "per_seat": per_seat,
        "spectator": {
            "type": "state",
            "room": game_room(game.id),
            "seq": last_seq,
            "payload": {
                "events": events_for_viewer(events, None),
                "state": engine.visible_state(state, None),
            },
        },
    }


async def apply_action(
    db: AsyncSession, game: Game, user: User, action_type: str, payload: dict
) -> tuple[dict | None, list[dict]]:
    """Validate + persist an in-game action.

    Returns (broadcast_message, events_for_client). Raises IllegalAction/ValueError.
    """
    if game.status != GameStatus.active.value:
        raise ValueError("Game is not active")
    seat = seat_of(game, user.id)
    if seat is None:
        raise PermissionError("You are not a player in this game")

    engine = get_engine(game.game_type)()
    # DEEP copy is critical: a shallow copy shares nested objects, so engine
    # mutations would make old == new and SQLAlchemy would skip the UPDATE
    # entirely (state silently never persisted).
    state = copy.deepcopy(game.state or {})
    result = engine.apply_action(state, seat, action_type, payload)

    # Persist events atomically with the new snapshot.
    seqs = []
    for ev in result.events:
        game.last_seq += 1
        seqs.append(game.last_seq)
        db.add(
            GameEvent(
                game_id=game.id,
                seq=game.last_seq,
                actor_user_id=user.id,
                action_type=ev["type"],
                payload={**ev.get("payload", {}), "seat": ev.get("seat")},
            )
        )
    game.state = state
    if result.finished:
        game.status = GameStatus.finished.value
        game.result = result.result
        game.finished_at = utcnow()
        await _apply_ratings(db, game, result.result or {})
    await db.commit()

    # Build per-seat visible snapshots (hidden-info ready).
    message = build_state_message(engine, game, state, result.events)
    return message, result.events


async def _apply_ratings(db: AsyncSession, game: Game, result: dict) -> None:
    """Elo update on game end (rated games). Stashes deltas into game.result."""
    if game.game_type != "chess":
        return
    winner_seat = result.get("winner_seat")
    seats = sorted(game.seats, key=lambda s: s.seat)
    if len(seats) != game.max_players:
        return  # abandon / odd seat count: skip rating
    users = await _load_users(db, game)
    players = [users.get(s.user_id) for s in seats]
    if any(p is None for p in players):
        return

    if winner_seat is None:
        score = [0.5, 0.5]
    else:
        score = [1.0 if s.seat == winner_seat else 0.0 for s in seats]

    (ra, rb) = (players[0].rating, players[1].rating)
    new_a, new_b, delta_a = elo_update(ra, rb, score[0])
    players[0].rating = new_a
    players[1].rating = new_b
    result["ratings"] = {
        str(seats[0].seat): {"old": ra, "new": new_a, "delta": delta_a},
        str(seats[1].seat): {"old": rb, "new": new_b, "delta": -delta_a},
    }


async def missed_events(db: AsyncSession, game: Game, after_seq: int) -> list[GameEvent]:
    rows = await db.scalars(
        select(GameEvent)
        .where(GameEvent.game_id == game.id, GameEvent.seq > after_seq)
        .order_by(GameEvent.seq)
    )
    return list(rows)


def event_envelope(room: str, ev: GameEvent) -> dict:
    return {
        "type": "event",
        "room": room,
        "seq": ev.seq,
        "payload": {"action_type": ev.action_type, **ev.payload},
    }


async def open_lobbies(db: AsyncSession, game_type: str | None = None) -> list[dict]:
    q = (
        select(Game)
        .where(Game.status == GameStatus.waiting.value)
        .options(selectinload(Game.seats))
        .order_by(Game.created_at.desc())
        .limit(50)
    )
    if game_type:
        q = q.where(Game.game_type == game_type)
    games = list(await db.scalars(q))
    users = await _load_users_many(db, games)
    # Hide full tables - there is nothing to join there.
    return [
        lobby_payload(g, users) for g in games if len(g.seats) < g.max_players
    ]


async def my_games(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    rows = await db.scalars(
        select(Game)
        .join(GameSeat, GameSeat.game_id == Game.id)
        .where(GameSeat.user_id == user_id, Game.status != GameStatus.waiting.value)
        .order_by(Game.created_at.desc())
        .limit(50)
    )
    games = list(rows)
    return [
        {
            "id": str(g.id),
            "game_type": g.game_type,
            "status": g.status,
            "result": g.result,
        }
        for g in games
    ]


async def _load_users(db: AsyncSession, game: Game) -> dict[uuid.UUID, User]:
    ids = [s.user_id for s in game.seats]
    return await _load_users_by_ids(db, ids)


async def _load_users_many(db: AsyncSession, games: list[Game]) -> dict[uuid.UUID, User]:
    ids = [u for g in games for u in (s.user_id for s in g.seats)]
    return await _load_users_by_ids(db, list(set(ids)))


async def _load_users_by_ids(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not ids:
        return {}
    rows = await db.scalars(select(User).where(User.id.in_(ids)))
    return {u.id: u for u in rows}
