"""Lobby TTL (10 minutes) and host cap of 2 waiting tables."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.game_service import (
    LOBBY_TTL,
    MAX_OPEN_LOBBIES,
    lobby_expires_at,
    lobby_payload,
)


def test_lobby_ttl_is_ten_minutes():
    assert LOBBY_TTL == timedelta(minutes=10)
    assert MAX_OPEN_LOBBIES == 2


def test_lobby_payload_exposes_created_and_expires_at():
    created = datetime(2026, 8, 28, 12, 0, tzinfo=UTC)
    game = SimpleNamespace(
        id=uuid4(),
        game_type="salem",
        status="waiting",
        max_players=12,
        created_by=uuid4(),
        created_at=created,
        seats=[],
    )
    payload = lobby_payload(game, {})
    assert payload["created_at"] == created.isoformat()
    assert payload["expires_at"] == (created + timedelta(minutes=10)).isoformat()
    assert lobby_expires_at(game) == created + LOBBY_TTL


from app.services.game_service import lobby_closed_reason


def test_join_expired_or_aborted_says_lobby_expired():
    now = datetime.now(UTC)
    expired = SimpleNamespace(status="waiting", created_at=now - timedelta(minutes=11))
    aborted = SimpleNamespace(status="aborted", created_at=now)
    active = SimpleNamespace(status="active", created_at=now - timedelta(minutes=30))
    waiting = SimpleNamespace(status="waiting", created_at=now)
    assert lobby_closed_reason(expired) == "Lobby expired"
    assert lobby_closed_reason(aborted) == "Lobby expired"
    assert lobby_closed_reason(active) == "Game already started"
    assert lobby_closed_reason(waiting) is None
