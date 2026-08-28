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
    """Bridge for running asyncio code (SQLAlchemy async) inside Celery tasks."""
    return asyncio.run(coro)
