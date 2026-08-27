"""Cross-worker online-presence, stored in Redis with TTL.

Each WebSocket registers a unique connection id. A user is online if any of
their connection keys still exist. TTL is refreshed on connect and ping so a
dead worker cannot leave a user stuck "online".
"""

from __future__ import annotations

import uuid

from app.realtime import bus

PRESENCE_TTL_SECONDS = 45
_USER_KEY = "presence:user:{user_id}"
_CONN_KEY = "presence:conn:{conn_id}"


def _user_key(user_id: uuid.UUID) -> str:
    return _USER_KEY.format(user_id=user_id)


def _conn_key(conn_id: uuid.UUID) -> str:
    return _CONN_KEY.format(conn_id=conn_id)


async def touch(user_id: uuid.UUID, conn_id: uuid.UUID) -> None:
    """Mark this connection online and refresh its TTL."""
    redis = bus.get_redis()
    await redis.sadd(_user_key(user_id), str(conn_id))
    await redis.set(_conn_key(conn_id), str(user_id), ex=PRESENCE_TTL_SECONDS)


async def drop(user_id: uuid.UUID, conn_id: uuid.UUID) -> None:
    """Remove a connection (WS disconnect). User stays online if others remain."""
    redis = bus.get_redis()
    await redis.delete(_conn_key(conn_id))
    await redis.srem(_user_key(user_id), str(conn_id))


async def is_online(user_id: uuid.UUID) -> bool:
    """True if the user has at least one unexpired connection on any worker."""
    redis = bus.get_redis()
    key = _user_key(user_id)
    conn_ids = await redis.smembers(key)
    if not conn_ids:
        return False
    online = False
    stale: list[str] = []
    for cid in conn_ids:
        if await redis.exists(_conn_key(uuid.UUID(str(cid)))):
            online = True
        else:
            stale.append(str(cid))
    if stale:
        await redis.srem(key, *stale)
    return online
