import logging
from datetime import timedelta

from sqlalchemy import delete, select, update

from app.db.base import utcnow
from app.db.session import SessionLocal
from app.models.game import Game, GameSeat, GameStatus
from app.models.refresh_token import RefreshToken
from app.workers.celery_app import celery_app, run_async

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.tasks.cleanup_expired_refresh_tokens")
def cleanup_expired_refresh_tokens() -> int:
    async def _run() -> int:
        async with SessionLocal() as db:
            result = await db.execute(
                delete(RefreshToken).where(RefreshToken.expires_at < utcnow())
            )
            await db.commit()
            return result.rowcount or 0

    deleted = run_async(_run())
    logger.info("Cleaned %s expired refresh tokens", deleted)
    return deleted


@celery_app.task(name="app.workers.tasks.cleanup_stale_lobbies")
def cleanup_stale_lobbies() -> int:
    """Abort lobbies that sat empty for over a day."""

    async def _run() -> int:
        cutoff = utcnow() - timedelta(hours=24)
        async with SessionLocal() as db:
            stale_ids = (
                select(Game.id)
                .where(Game.status == GameStatus.waiting.value, Game.created_at < cutoff)
                .subquery()
            )
            await db.execute(delete(GameSeat).where(GameSeat.game_id.in_(stale_ids)))
            result = await db.execute(
                update(Game)
                .where(Game.status == GameStatus.waiting.value, Game.created_at < cutoff)
                .values(status=GameStatus.aborted.value)
            )
            await db.commit()
            return result.rowcount or 0

    aborted = run_async(_run())
    logger.info("Aborted %s stale lobbies", aborted)
    return aborted
