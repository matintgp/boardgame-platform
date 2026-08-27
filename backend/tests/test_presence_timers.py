"""Presence + timer-lock coordination across workers (mocked Redis)."""

from __future__ import annotations

import time
import uuid

import pytest

from app.realtime import presence
from app.realtime.hub import hub
from app.realtime.timers import (
    LOCK_TTL_SECONDS,
    acquire_timer_lock,
    release_timer_lock,
)


@pytest.mark.asyncio
async def test_presence_shared_across_workers(fake_redis):
    uid = uuid.uuid4()
    c1, c2 = uuid.uuid4(), uuid.uuid4()

    assert await presence.is_online(uid) is False
    await presence.touch(uid, c1)
    assert await presence.is_online(uid) is True
    assert await hub.user_online(uid) is True

    # Second connection (other tab / other worker) keeps the user online.
    await presence.touch(uid, c2)
    await presence.drop(uid, c1)
    assert await presence.is_online(uid) is True

    await presence.drop(uid, c2)
    assert await presence.is_online(uid) is False
    assert await hub.user_online(uid) is False


@pytest.mark.asyncio
async def test_presence_expires_when_ttl_elapses(fake_redis):
    uid = uuid.uuid4()
    conn = uuid.uuid4()
    await presence.touch(uid, conn)
    assert await presence.is_online(uid) is True

    conn_key = f"presence:conn:{conn}"
    fake_redis.expiry[conn_key] = time.time() - 1
    assert await presence.is_online(uid) is False


@pytest.mark.asyncio
async def test_presence_touch_refreshes_ttl(fake_redis):
    uid = uuid.uuid4()
    conn = uuid.uuid4()
    await presence.touch(uid, conn)
    conn_key = f"presence:conn:{conn}"
    fake_redis.expiry[conn_key] = time.time() + 1
    await presence.touch(uid, conn)
    assert fake_redis.expiry[conn_key] > time.time() + 10
    assert await presence.is_online(uid) is True


@pytest.mark.asyncio
async def test_timer_lock_only_one_leader(fake_redis):
    gid = uuid.uuid4()
    leader, other = "token-a", "token-b"

    assert await acquire_timer_lock(gid, leader) is True
    assert await acquire_timer_lock(gid, other) is False
    # Holder can refresh.
    assert await acquire_timer_lock(gid, leader) is True
    assert await acquire_timer_lock(gid, other) is False

    await release_timer_lock(gid, leader)
    assert await acquire_timer_lock(gid, other) is True
    # Previous leader cannot steal while other holds it.
    assert await acquire_timer_lock(gid, leader) is False


@pytest.mark.asyncio
async def test_timer_lock_failover_after_expiry(fake_redis):
    gid = uuid.uuid4()
    assert await acquire_timer_lock(gid, "a") is True
    key = f"timer:lock:{gid}"
    fake_redis.expiry[key] = time.time() - 1
    assert await acquire_timer_lock(gid, "b") is True
    assert await acquire_timer_lock(gid, "a") is False


@pytest.mark.asyncio
async def test_release_is_token_scoped(fake_redis):
    gid = uuid.uuid4()
    assert await acquire_timer_lock(gid, "owner") is True
    await release_timer_lock(gid, "impostor")
    # Impostor must not have released the owner's lock.
    assert await acquire_timer_lock(gid, "impostor") is False
    await release_timer_lock(gid, "owner")
    assert await acquire_timer_lock(gid, "impostor") is True


def test_lock_ttl_covers_tick_interval():
    from app.realtime.timers import TICK_SECONDS

    assert LOCK_TTL_SECONDS > TICK_SECONDS
