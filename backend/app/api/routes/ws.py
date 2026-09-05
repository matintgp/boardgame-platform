"""WebSocket endpoint.

Client -> server:  {"type": "auth"|"subscribe"|"unsubscribe"|"sync"|"action",
                    "room": "...", "last_seq": n, "payload": {...}}
Server -> client:  envelopes {"type": ..., "room": ..., "seq": ..., "payload": ...}

Auth: the client connects with no credentials on the URL, then MUST send
{"type":"auth","token":"<access JWT>"} as the first message. Query-string
tokens are ignored. Unauthenticated sockets are closed (4401).
Rooms are authorized against game membership; actions are re-validated
by the engine server-side.
"""

import asyncio
import copy
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.games.base import IllegalAction
from app.games.registry import get_engine

logger = logging.getLogger(__name__)

from app.core.deps import MAX_WS_MESSAGE_BYTES, user_from_access_token
from app.db.session import SessionLocal
from app.models.user import User
from app.realtime import bus, presence
from app.services import game_service

router = APIRouter()

AUTH_TIMEOUT_SECONDS = 10.0


async def _authorize_room(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> int | None:
    """Returns seat if player, None if spectator-allowed (phase 0: members only)."""
    game = await game_service.get_game(db, game_id)
    if game is None:
        raise ValueError("game not found")
    return game_service.seat_of(game, user_id)


async def wait_for_auth(websocket: WebSocket) -> User | None:
    """Consume the first frame. Only {"type":"auth","token":"..."} is accepted.

    Query-string tokens are deliberately ignored so JWTs never land in logs/history.
    """
    try:
        raw = await asyncio.wait_for(
            websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS
        )
    except (TimeoutError, WebSocketDisconnect):
        return None
    if len(raw.encode()) > MAX_WS_MESSAGE_BYTES:
        return None
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(msg, dict) or msg.get("type") != "auth":
        return None
    token = msg.get("token")
    if not isinstance(token, str) or not token:
        return None
    return await user_from_access_token(token)


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    user = await wait_for_auth(websocket)
    if user is None:
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        return

    from app.realtime.hub import hub

    conn_id = uuid.uuid4()
    await hub.connect(user.id, websocket)
    await presence.touch(user.id, conn_id)

    # NOTE: Redis fan-out is handled by the single app-level listener in
    # main.py's lifespan - do NOT add a per-connection listener here or every
    # message is delivered once per connected socket.
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > MAX_WS_MESSAGE_BYTES:
                await websocket.send_json({"type": "error", "payload": {"message": "too large"}})
                continue
            try:
                msg = json.loads(raw)
                mtype = msg.get("type")
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "payload": {"message": "bad json"}})
                continue

            room = msg.get("room", "")
            try:
                if mtype == "ping":
                    await presence.touch(user.id, conn_id)
                    await websocket.send_json({"type": "pong"})
                    continue

                if not room.startswith("game:") or len(room.split(":")) != 2:
                    raise ValueError("invalid room")
                game_id = uuid.UUID(room.split(":", 1)[1])

                if mtype == "subscribe":
                    async with SessionLocal() as db:
                        seat = await _authorize_room(db, user.id, game_id)
                    if seat is None:
                        raise PermissionError("not a member")
                    await hub.subscribe(user.id, room, seat)
                    # Initial snapshot for this member.
                    async with SessionLocal() as db:
                        game = await game_service.get_game(db, game_id)
                        if game and game.state:

                            engine = get_engine(game.game_type)()
                            await websocket.send_json({
                                "type": "state", "room": room,
                                "seq": game.last_seq,
                                "payload": {
                                    "events": [],
                                    "state": engine.visible_state(game.state, seat),
                                },
                            })
                    await websocket.send_json({"type": "subscribed", "room": room})

                elif mtype == "sync":
                    last_seq = int(msg.get("last_seq", 0))
                    async with SessionLocal() as db:
                        seat = await _authorize_room(db, user.id, game_id)
                        if seat is None:
                            raise PermissionError("not a member")
                        game = await game_service.get_game(db, game_id)
                        if game is None:
                            raise ValueError("game not found")
                        # Waiting lobbies have no events yet - send roster instead.
                        # game_view includes the CALLING user's your_seat/is_host,
                        # so a page opened before joining learns its seat here.
                        if game.status == "waiting":
                            roster = await game_service.game_view(db, game, user)
                            await websocket.send_json({
                                "type": "lobby_update", "room": room, "seq": None,
                                "payload": roster,
                            })
                        elif game.status == "active" and game.game_type == "chess":
                            # Lazy timer (re)start + offline-resume.
                            from app.realtime.timers import start_timer

                            start_timer(game.id)
                            st = copy.deepcopy(game.state or {})
                            if st.get("paused") and st["paused"].get("seat") == seat:
                                st["paused"] = None
                                import time as _time

                                st["turn_started_at"] = _time.time()
                                game.state = st
                                await db.commit()
                                await bus.publish_internal(
                                    game_service.build_state_message(
                                        get_engine(game.game_type)(), game, st, [])
                                )
                        events = await game_service.missed_events(db, game, last_seq)
                        for ev in events:
                            if not game_service.event_visible_to(ev, seat):
                                continue
                            await websocket.send_json(game_service.event_envelope(room, ev))
                        if game.state:

                            engine = get_engine(game.game_type)()
                            await websocket.send_json({
                                "type": "state", "room": room,
                                "seq": game.last_seq,
                                "payload": {"events": [], "state": engine.visible_state(game.state, seat)},
                            })
                    await hub.subscribe(user.id, room, seat)

                elif mtype == "action":
                    payload = msg.get("payload") or {}
                    action_type = msg.get("action", "move")
                    # Nested envelope: {action, payload:{action, payload:{...}}}
                    if isinstance(payload, dict) and "action" in payload and "payload" in payload:
                        action_type = payload["action"]
                        inner = payload["payload"]
                        payload = inner if isinstance(inner, dict) else {}
                    async with SessionLocal() as db:
                        seat = await _authorize_room(db, user.id, game_id)
                        if seat is None:
                            raise PermissionError("not a member")
                        game = await game_service.get_game(db, game_id, for_update=True)
                        if game is None:
                            raise ValueError("game not found")
                        message, _ = await game_service.apply_action(
                            db, game, user, action_type, payload
                        )
                    await bus.publish_internal(message)

                elif mtype == "chat":
                    text = str((msg.get("payload") or {}).get("text", "")).strip()[:500]
                    if not text:
                        continue
                    async with SessionLocal() as db:
                        game = await game_service.get_game(db, game_id)
                        from app.games.chess_bot import is_bot_game

                        if game is not None and is_bot_game(game.settings):
                            await websocket.send_json(
                                {"type": "error", "room": room,
                                 "payload": {"message": "bot_no_chat"}}
                            )
                            continue
                    from app.core.limiter import rate_limit

                    if not await rate_limit(f"chat:{user.id}", 8, 10):
                        await websocket.send_json(
                            {"type": "error", "room": room,
                             "payload": {"message": "slow down (chat rate limit)"}}
                        )
                        continue
                    async with SessionLocal() as db:
                        seat = await _authorize_room(db, user.id, game_id)
                        if seat is None:
                            raise PermissionError("not a member")
                        game = await game_service.get_game(db, game_id)
                        if game is None:
                            raise ValueError("game not found")
                        game.last_seq += 1
                        seq = game.last_seq
                        from app.models.game_event import GameEvent

                        db.add(GameEvent(
                            game_id=game.id, seq=seq, actor_user_id=user.id,
                            action_type="chat",
                            payload={"text": text, "username": user.username, "seat": seat},
                        ))
                        await db.commit()
                    await bus.publish_internal({
                        "room": room,
                        "per_seat": {}, "spectator": None, "direct": {},
                        "broadcast": {"type": "chat", "room": room, "seq": seq,
                                      "payload": {"text": text, "username": user.username,
                                                  "seat": seat}},
                    })

                elif mtype == "unsubscribe":
                    await hub.unsubscribe(user.id, room)

                else:
                    raise ValueError(f"unknown type {mtype!r}")

            except (ValueError, KeyError, PermissionError, IllegalAction) as e:
                await websocket.send_json(
                    {"type": "error", "room": room, "payload": {"message": str(e)}}
                )
            except Exception:
                # Unexpected: log internally, never leak internals to clients.
                logger.exception("WS action failed (room=%s)", room)
                await websocket.send_json(
                    {"type": "error", "room": room,
                     "payload": {"message": "internal error, please retry"}}
                )

    except WebSocketDisconnect:
        pass
    finally:
        try:
            await presence.drop(user.id, conn_id)
        except Exception:
            logger.exception("presence drop failed")
        await hub.disconnect(user.id, websocket)
