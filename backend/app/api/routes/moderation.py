import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_rate_limit
from app.models.report import Report
from app.models.user import User

router = APIRouter(tags=["moderation"])


class ReportIn(BaseModel):
    reported_user_id: str
    reason: str = Field(min_length=3, max_length=500)
    game_id: str | None = None


@router.post("/reports", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_rate_limit("report", limit=10, window_seconds=3600))])
async def create_report(body: ReportIn, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    reported = await db.get(User, uuid.UUID(body.reported_user_id))
    if reported is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    db.add(Report(
        reporter_id=user.id,
        reported_user_id=reported.id,
        game_id=uuid.UUID(body.game_id) if body.game_id else None,
        reason=body.reason,
    ))
    await db.commit()
    return {"ok": True}


class BanIn(BaseModel):
    banned: bool


@router.post("/admin/users/{user_id}/ban")
async def ban_user(user_id: uuid.UUID, body: BanIn,
                   admin: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    if not admin.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    target.is_active = not body.banned
    await db.commit()
    return {"ok": True, "banned": body.banned}
