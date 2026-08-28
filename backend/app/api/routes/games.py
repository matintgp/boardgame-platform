import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.games.base import IllegalAction
from app.games.registry import ENGINES, get_engine
from app.models.user import User
from app.schemas.api import ActionIn, CreateGameIn
from app.services import game_service, matchmaking

router = APIRouter(prefix="/games", tags=["games"])


@router.get("/catalog")
async def catalog() -> list[dict]:
    return [
        {"id": cls.game_id, "name": cls.name, "min_players": cls.min_players,
         "max_players": cls.max_players}
        for cls in ENGINES.values()
    ]


@router.get("/lobbies")
async def lobbies(game_type: str | None = None,
                  user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await game_service.open_lobbies(db, game_type)


@router.get("/mine")
async def mine(user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await game_service.my_games(db, user.id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create(body: CreateGameIn, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> dict:
    try:
        engine_cls = get_engine(body.game_type)
    except KeyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    try:
        game = await game_service.create_game(db, user, engine_cls, body.settings)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    return {
        "id": str(game.id),
        "game_type": game.game_type,
        "status": game.status,
        "created_at": game_service._iso(game.created_at),
        "expires_at": game_service._iso(game_service.lobby_expires_at(game)),
    }


@router.get("/{game_id}")
async def get_game(game_id: uuid.UUID, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    game = await game_service.get_game(db, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    return await game_service.game_view(db, game, user)


@router.post("/queue")
async def queue_join(body: CreateGameIn, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Idempotent: poll this every few seconds until paired."""
    try:
        engine_cls = get_engine(body.game_type)
    except KeyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return await matchmaking.join_queue(db, user, engine_cls)


@router.delete("/queue")
async def queue_leave(game_type: str = "chess",
                      user: User = Depends(get_current_user)) -> dict:
    await matchmaking.leave_queue(user.id, game_type)
    return {"ok": True}


@router.post("/{game_id}/rematch")
async def rematch(game_id: uuid.UUID, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Open a new waiting table for the requester and ping former opponents."""
    game = await game_service.get_game(db, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    try:
        new_game, invitees = await game_service.offer_rematch(db, game, user)
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e

    from app.realtime import bus

    payload = {"game_id": str(new_game.id), "by": user.username}
    await bus.publish_internal({
        "room": "",
        "per_seat": {},
        "spectator": None,
        "direct": {
            str(uid): {"type": "rematch", "payload": payload}
            for uid in invitees
        },
    })
    return {"game_id": str(new_game.id)}


@router.get("/{game_id}/voice-token")
async def voice_token(game_id: uuid.UUID, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """LiveKit access token for the game's voice room (members only)."""
    import time as time_mod

    import jwt

    from app.core.config import settings

    game = await game_service.get_game(db, game_id)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    if game_service.seat_of(game, user.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member")
    now = int(time_mod.time())
    token = jwt.encode(
        {
            "exp": now + 6 * 3600,
            "iss": settings.livekit_api_key,
            "nbf": now,
            "sub": str(user.id),
            "name": user.username,
            "video": {
                "room": f"voice:{game_id}",
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        },
        settings.livekit_api_secret,
        algorithm="HS256",
    )
    return {"token": token, "url": settings.livekit_public_url, "identity": user.username}


@router.post("/{game_id}/join")
async def join(game_id: uuid.UUID, user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)) -> dict:
    game = await game_service.get_game(db, game_id, for_update=True)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    try:
        payload = await game_service.join_game(db, game, user)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    from app.realtime import bus

    await bus.publish_internal({"room": game_service.game_room(game.id),
                                "per_seat": {}, "spectator": None,
                                "direct": {},
                                "broadcast": {"type": "lobby_update",
                                              "room": game_service.game_room(game.id),
                                              "seq": None,
                                              "payload": payload}})
    return payload


@router.post("/{game_id}/start")
async def start(game_id: uuid.UUID, user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_db)) -> dict:
    game = await game_service.get_game(db, game_id, for_update=True)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    try:
        message = await game_service.start_game(db, game, user)
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    if game.game_type == "chess":
        from app.realtime.timers import start_timer

        start_timer(game.id)
    from app.realtime import bus

    await bus.publish_internal(message)
    return {"ok": True}


@router.post("/{game_id}/action")
async def action(game_id: uuid.UUID, body: ActionIn,
                 user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """REST fallback for moves (WS is the primary path)."""
    game = await game_service.get_game(db, game_id, for_update=True)
    if game is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Game not found")
    try:
        message, _events = await game_service.apply_action(
            db, game, user, body.action, body.payload
        )
    except IllegalAction as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except Exception as e:
        if isinstance(e, (ValueError, PermissionError)):
            raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    from app.realtime import bus

    await bus.publish_internal(message)
    return {"ok": True}

