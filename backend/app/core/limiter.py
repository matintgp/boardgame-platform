"""Redis-backed rate limiter used by REST auth routes."""

import time

from app.realtime.bus import get_redis


async def rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Fixed-window counter. Returns False when the limit is exceeded."""
    redis = get_redis()
    bucket_key = f"{key}:{int(time.time()) // window_seconds}"
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(bucket_key)
        pipe.expire(bucket_key, window_seconds + 1)
        count, _ = await pipe.execute()
    return int(count) <= limit
