import asyncio

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "boardgame",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    imports=("app.workers.tasks",),
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    beat_schedule={
        "cleanup-expired-refresh-tokens": {
            "task": "app.workers.tasks.cleanup_expired_refresh_tokens",
            "schedule": crontab(hour=3, minute=0),
        },
        "cleanup-stale-lobbies": {
            "task": "app.workers.tasks.cleanup_stale_lobbies",
            "schedule": crontab(minute="*"),
        },
    },
)


def run_async(coro):
    """Run asyncio code inside a Celery worker.

    Each asyncio.run() creates a fresh event loop. Async SQLAlchemy engines and
    redis.asyncio clients are loop-bound, so we dispose/re-init around every call.
    """

    async def _wrapped():
        from app.db import session as db_session
        from app.realtime import bus

        await db_session.engine.dispose()
        await bus.close_redis()
        await bus.init_redis()
        try:
            return await coro
        finally:
            await bus.close_redis()
            await db_session.engine.dispose()

    return asyncio.run(_wrapped())
