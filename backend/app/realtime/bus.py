"""Redis client + pub/sub bus.

All app processes publish internal messages to one channel; every process
subscribes once and forwards to its locally-connected WebSockets. This makes
nodes stateless and horizontally scalable (no sticky sessions needed).
"""

import asyncio
import json

import redis.asyncio as aioredis

from app.core.config import settings

_redis: aioredis.Redis | None = None
CHANNEL = "bg:events"


async def init_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    await _redis.ping()
    return _redis


def get_redis() -> aioredis.Redis:
    if _redis is None:
        raise RuntimeError("Redis not initialized - call init_redis() at startup")
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def publish_internal(message: dict) -> None:
    """Fan a message out to all backend nodes."""
    redis = _redis
    if redis is None:
        redis = await init_redis()
    await redis.publish(CHANNEL, json.dumps(message, default=str))


async def listen(handler) -> None:
    """Subscribe forever. `handler(message: dict)` is called for each message."""
    redis = get_redis()
    pubsub = redis.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(CHANNEL)
    try:
        async for raw in pubsub.listen():
            if raw is None or raw.get("type") != "message":
                continue
            try:
                message = json.loads(raw["data"])
            except (json.JSONDecodeError, TypeError):
                continue
            try:
                result = handler(message)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # noqa: S110 - one bad message must not kill the listener
                continue
    finally:
        await pubsub.unsubscribe(CHANNEL)
        await pubsub.aclose()
