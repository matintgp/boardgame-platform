import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.api import FriendRequestActionIn, FriendRequestIn
from app.services import friend_service

router = APIRouter(prefix="/friends", tags=["friends"])


@router.post("/request")
async def send_request(body: FriendRequestIn,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    target = await friend_service.search_users(db, body.username)
    exact = next((u for u in target if u["username"].lower() == body.username.lower()), None)
    if exact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    addressee = await db.get(User, uuid.UUID(exact["id"]))
    assert addressee is not None
    try:
        fr = await friend_service.request_friend(db, user, addressee)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    return {"request_id": str(fr.id)}


@router.get("")
async def list_friends(user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await friend_service.list_friends(db, user.id)


@router.post("/respond")
async def respond(body: FriendRequestActionIn,
                  user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)) -> dict:
    try:
        await friend_service.respond(db, user.id, uuid.UUID(body.request_id), body.accept)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    return {"ok": True}


@router.get("/search")
async def search(q: str, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> list[dict]:
    if len(q) < 2:
        return []
    return await friend_service.search_users(db, q)
