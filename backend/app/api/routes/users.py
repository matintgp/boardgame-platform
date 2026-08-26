import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/{user_id}")
async def get_profile(user_id: uuid.UUID,
                      _: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user.public_profile()
