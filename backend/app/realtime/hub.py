"""In-process WebSocket registry.

Tracks local connections per user and room subscriptions. Combined with the
Redis bus this forms a scalable fan-out layer: each node only touches sockets
that connected to it.

Presence (is the user online anywhere?) is Redis-backed so chess timers on
any worker see the same truth. See `app.realtime.presence`.
"""

import asyncio
import uuid

from fastapi import WebSocket


class ConnectionHub:
    def __init__(self) -> None:
        self._users: dict[uuid.UUID, set[WebSocket]] = {}
        # room -> {user_id: seat or None(spectator)}
        self._rooms: dict[str, dict[uuid.UUID, int | None]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        """Register an already-accepted socket. Caller must `await ws.accept()`."""
        async with self._lock:
            self._users.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._users.get(user_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    del self._users[user_id]
            for members in self._rooms.values():
                members.pop(user_id, None)

    async def subscribe(self, user_id: uuid.UUID, room: str, seat: int | None) -> None:
        async with self._lock:
            self._rooms.setdefault(room, {})[user_id] = seat

    async def unsubscribe(self, user_id: uuid.UUID, room: str) -> None:
        async with self._lock:
            members = self._rooms.get(room)
            if members is not None:
                members.pop(user_id, None)

    def user_seat_in_room(self, user_id: uuid.UUID, room: str) -> int | None | object:
        """Returns seat, None (spectator), or MISSING sentinel if not subscribed."""
        members = self._rooms.get(room)
        if members is None or user_id not in members:
            return _MISSING
        return members[user_id]

    @property
    def MISSING(self) -> object:
        return _MISSING

    async def user_online(self, user_id: uuid.UUID) -> bool:
        """True if the user has a live WebSocket on any worker (Redis presence)."""
        from app.realtime.presence import is_online

        return await is_online(user_id)

    async def send_to_user(self, user_id: uuid.UUID, envelope: dict) -> None:
        dead = []
        for ws in list(self._users.get(user_id, ())):
            try:
                await ws.send_json(envelope)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                conns = self._users.get(user_id)
                if conns:
                    for ws in dead:
                        conns.discard(ws)

    async def broadcast_internal(self, message: dict) -> None:
        """Route an internal bus message to local sockets.

        Expected shape: {"room": str, "per_seat": {"0": env, "1": env},
                         "spectator": env|None, "direct": {user_id: env}}
        """
        room = message.get("room")
        per_seat = message.get("per_seat") or {}
        spectator_env = message.get("spectator")
        direct = message.get("direct") or {}

        targets: list[tuple[uuid.UUID, dict]] = []
        broadcast_env = message.get("broadcast")
        if broadcast_env is not None and room:
            members = self._rooms.get(room, {})
            for uid in members:
                targets.append((uid, broadcast_env))
        elif room:
            members = self._rooms.get(room, {})
            for uid, seat in members.items():
                env = per_seat.get(str(seat), spectator_env)
                if env is not None:
                    targets.append((uid, env))
        for uid_str, env in direct.items():
            targets.append((uuid.UUID(uid_str), env))

        seen: set[uuid.UUID] = set()
        for uid, env in targets:
            if uid in seen:
                continue
            seen.add(uid)
            await self.send_to_user(uid, env)


_MISSING = object()
hub = ConnectionHub()
