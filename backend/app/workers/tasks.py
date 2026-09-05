import logging

from sqlalchemy import delete

from app.db.base import utcnow
from app.db.session import SessionLocal
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
    """Abort waiting lobbies past the 10-minute TTL."""

    async def _run() -> int:
        from app.services.game_service import abort_expired_lobbies

        async with SessionLocal() as db:
            return await abort_expired_lobbies(db)

    aborted = run_async(_run())
    logger.info("Aborted %s stale lobbies", aborted)
    return aborted



@celery_app.task(name="app.workers.tasks.compute_bot_move", bind=True, max_retries=0)
def compute_bot_move(self, game_id: str, expected_seq: int, attempt: int = 0) -> bool:
    """Idempotent Stockfish move: (game_id, expected_seq, still active, still bot turn)."""
    import uuid as _uuid

    from app.services.bot_match import run_bot_move

    async def _run() -> bool:
        msg = await run_bot_move(
            _uuid.UUID(game_id), int(expected_seq), attempt=int(attempt)
        )
        return msg is not None

    applied = run_async(_run())
    logger.info(
        "bot move game=%s seq=%s attempt=%s applied=%s",
        game_id,
        expected_seq,
        attempt,
        applied,
    )
    return applied
