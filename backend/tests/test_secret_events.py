"""Hidden-info: night_action / vote_cast must not leak actor seat to town."""

from app.models.game_event import GameEvent
from app.services.game_service import (
    SECRET_EVENT_TYPES,
    event_visible_to,
    events_for_viewer,
)


def test_night_action_only_reaches_actor():
    events = [
        {"type": "night_action", "seat": 2, "payload": {}},
        {"type": "night_resolved", "seat": None, "payload": {"killed": 0}},
    ]
    actor = events_for_viewer(events, 2)
    town = events_for_viewer(events, 0)
    spec = events_for_viewer(events, None)
    assert [e["type"] for e in actor] == ["night_action", "night_resolved"]
    assert [e["type"] for e in town] == ["night_resolved"]
    assert [e["type"] for e in spec] == ["night_resolved"]
    assert all("seat" not in e or e["seat"] != 2 for e in town if e["type"] != "night_resolved")


def test_vote_cast_only_reaches_voter():
    events = [
        {"type": "vote_cast", "seat": 1, "payload": {}},
        {"type": "vote_resolved", "seat": None, "payload": {"eliminated": 1, "tie": False}},
    ]
    assert [e["type"] for e in events_for_viewer(events, 1)] == ["vote_cast", "vote_resolved"]
    assert [e["type"] for e in events_for_viewer(events, 3)] == ["vote_resolved"]


def test_chess_moves_stay_public():
    events = [{"type": "move", "seat": 0, "payload": {"san": "e4"}}]
    assert events_for_viewer(events, 1) == events
    assert events_for_viewer(events, None) == events


def test_persisted_night_action_hidden_from_town():
    ev = GameEvent(
        action_type="night_action",
        payload={"seat": 2},
    )
    assert "night_action" in SECRET_EVENT_TYPES
    assert event_visible_to(ev, 2) is True
    assert event_visible_to(ev, 0) is False
    assert event_visible_to(ev, None) is False
