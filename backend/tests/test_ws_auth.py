"""WebSocket handshake: first frame must be auth; query-string JWT is ignored."""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi import WebSocketDisconnect
from starlette.datastructures import QueryParams

from app.api.routes.ws import wait_for_auth, ws_endpoint
from app.core.security import create_access_token


class DummyWS:
    def __init__(self, messages: list[str], query: dict[str, str] | None = None) -> None:
        self.query_params = QueryParams(query or {})
        self._messages = list(messages)
        self.close_code: int | None = None
        self.sent: list[dict] = []
        self.accepted = False
        self.client = SimpleNamespace(host="test")

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.close_code = code

    async def receive_text(self) -> str:
        if not self._messages:
            raise WebSocketDisconnect()
        return self._messages.pop(0)

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)


@pytest.mark.asyncio
async def test_ws_rejects_query_string_only_auth():
    """A valid JWT on ?token= is NOT enough; first message must be type=auth."""
    token = create_access_token(uuid.uuid4())
    ws = DummyWS(
        messages=[json.dumps({"type": "ping"})],
        query={"token": token},
    )
    await ws_endpoint(ws)
    assert ws.accepted is True
    assert ws.close_code == 4401


@pytest.mark.asyncio
async def test_ws_rejects_sync_before_auth():
    ws = DummyWS(messages=[json.dumps({"type": "sync", "room": "game:" + str(uuid.uuid4())})])
    await ws_endpoint(ws)
    assert ws.close_code == 4401


@pytest.mark.asyncio
async def test_ws_rejects_garbage_auth_token():
    ws = DummyWS(messages=[json.dumps({"type": "auth", "token": "not-a-jwt"})])
    await ws_endpoint(ws)
    assert ws.close_code == 4401


@pytest.mark.asyncio
async def test_wait_for_auth_ignores_query_token():
    token = create_access_token(uuid.uuid4())
    ws = DummyWS(
        messages=[json.dumps({"type": "ping"})],
        query={"token": token},
    )
    user = await wait_for_auth(ws)
    assert user is None


@pytest.mark.asyncio
async def test_wait_for_auth_rejects_empty_token_field():
    ws = DummyWS(messages=[json.dumps({"type": "auth", "token": ""})])
    assert await wait_for_auth(ws) is None


@pytest.mark.asyncio
async def test_wait_for_auth_rejects_non_json():
    ws = DummyWS(messages=["not-json"])
    assert await wait_for_auth(ws) is None


@pytest.mark.asyncio
async def test_ws_disconnect_before_auth_closes_unauthenticated():
    ws = DummyWS(messages=[])
    await ws_endpoint(ws)
    assert ws.close_code == 4401
