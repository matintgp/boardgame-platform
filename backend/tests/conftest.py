"""Shared test fixtures. Env vars must be set before any app import."""

from __future__ import annotations

import os
import time

os.environ.setdefault("SECRET_KEY", "pytest-secret-key-not-for-production-use")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("ENV", "test")

import pytest


class FakeRedis:
    """Minimal async Redis stand-in for presence + timer locks."""

    def __init__(self) -> None:
        self.kv: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}
        self.zsets: dict[str, dict[str, float]] = {}
        self.expiry: dict[str, float] = {}

    def _expired(self, key: str) -> bool:
        exp = self.expiry.get(key)
        return exp is not None and exp < time.time()

    def _purge(self, key: str) -> None:
        self.kv.pop(key, None)
        self.sets.pop(key, None)
        self.zsets.pop(key, None)
        self.expiry.pop(key, None)

    def _alive_str(self, key: str) -> bool:
        if key not in self.kv:
            return False
        if self._expired(key):
            self._purge(key)
            return False
        return True

    async def set(self, key: str, value: str, ex: int | None = None, nx: bool = False):
        if nx and self._alive_str(key):
            return False
        self.kv[key] = str(value)
        if ex is not None:
            self.expiry[key] = time.time() + ex
        else:
            self.expiry.pop(key, None)
        return True

    async def get(self, key: str):
        if not self._alive_str(key):
            return None
        return self.kv.get(key)

    async def expire(self, key: str, seconds: int) -> bool:
        if not self._alive_str(key) and key not in self.sets:
            return False
        self.expiry[key] = time.time() + seconds
        return True

    async def delete(self, *keys: str) -> int:
        n = 0
        for k in keys:
            existed = k in self.kv or k in self.sets
            if existed and not self._expired(k):
                n += 1
            self._purge(k)
        return n

    async def exists(self, key: str) -> int:
        if self._alive_str(key):
            return 1
        if key in self.sets and not self._expired(key):
            return 1
        return 0

    async def sadd(self, key: str, *members: str) -> int:
        s = self.sets.setdefault(key, set())
        before = len(s)
        s.update(str(m) for m in members)
        return len(s) - before

    async def srem(self, key: str, *members: str) -> int:
        s = self.sets.get(key)
        if not s:
            return 0
        n = 0
        for m in members:
            m = str(m)
            if m in s:
                s.discard(m)
                n += 1
        return n

    async def smembers(self, key: str) -> set[str]:
        if key in self.sets and self._expired(key):
            self._purge(key)
            return set()
        return set(self.sets.get(key, set()))

    async def zadd(self, key: str, mapping: dict) -> int:
        z = self.zsets.setdefault(key, {})
        added = 0
        for member, score in mapping.items():
            member = str(member)
            if member not in z:
                added += 1
            z[member] = float(score)
        return added

    async def zrange(self, key: str, start: int, end: int) -> list[str]:
        z = self.zsets.get(key, {})
        ordered = [m for m, _ in sorted(z.items(), key=lambda kv: (kv[1], kv[0]))]
        n = len(ordered)
        if n == 0:
            return []
        if start < 0:
            start = n + start
        end_idx = end if end >= 0 else n + end
        return ordered[start : end_idx + 1]

    async def zrem(self, key: str, *members: str) -> int:
        z = self.zsets.get(key)
        if not z:
            return 0
        n = 0
        for m in members:
            m = str(m)
            if m in z:
                del z[m]
                n += 1
        return n

    async def zremrangebyscore(self, key: str, min_score, max_score) -> int:
        z = self.zsets.get(key)
        if not z:
            return 0
        to_del = [m for m, s in z.items() if float(min_score) <= s <= float(max_score)]
        for m in to_del:
            del z[m]
        return len(to_del)


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setattr("app.realtime.bus.get_redis", lambda: fake)
    return fake
