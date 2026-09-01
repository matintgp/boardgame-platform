"""Salem 1692 engine: tryals, day cards, conspiracy, night, hidden info."""

from __future__ import annotations

import time

import pytest

from app.games.base import IllegalAction
from app.games.registry import ENGINES, get_engine
from app.games.salem_data import TRYAL_CONSTABLE, TRYAL_COUNTS, TRYAL_INNOCENT, TRYAL_WITCH
from app.games.salem_engine import SalemEngine


@pytest.fixture
def engine():
    return SalemEngine()


def make_game(engine: SalemEngine, n: int = 4, seed: int = 1):
    seats = [f"user-{i}" for i in range(n)]
    state = engine.init_state({"seed": seed}, seats)
    if state["phase"] == "town_hall":
        for s in range(n):
            opts = state["town_hall_options"][str(s)]
            engine.apply_action(
                state, s, "choose_town_hall", {"character_id": opts[0]["id"]}
            )
    return state


def find_tryal(state, card_id, *, revealed=False):
    for s, row in state["tryals"].items():
        for i, c in enumerate(row):
            if c["id"] == card_id and c["revealed"] is revealed:
                return int(s), i
    raise AssertionError(f"no {card_id} with revealed={revealed}")


def witches_of(state) -> list[int]:
    return list(state["witches"])


def strip_abilities(state) -> None:
    """Neutralize Town Hall so tests hit the base rules."""
    for s in state["town_hall"]:
        state["town_hall"][s] = {"id": "crowd_voice", "name": "Crowd Voice"}


def give_card(state, seat: int, card_id: str) -> None:
    state["hands"][str(seat)].append(card_id)
    state["current_seat"] = seat
    state["phase"] = "day"


def play(engine, state, seat, card_id, target=None, extra=None):
    give_card(state, seat, card_id)
    payload = {"card_id": card_id}
    if target is not None:
        payload["target"] = target
    if extra is not None:
        payload["extra"] = extra
    return engine.apply_action(state, seat, "play_card", payload)


def skip_all_confess(engine, state):
    res = None
    for s in engine._alive_seats(state):
        if state["phase"] != "confess":
            break
        res = engine.apply_action(state, s, "confess_skip", {})
    return res


def run_night(engine, state, *, kill_target: int, gavel_target: int | None = None):
    """Force night and resolve with optional gavel, all confess_skip."""
    strip_abilities(state)
    if state["phase"] != "night":
        play(engine, state, state["current_seat"], "night")
    assert state["phase"] == "night"
    witches = engine._alive_witches(state)
    res = None
    for w in witches:
        res = engine.apply_action(state, w, "night_kill", {"target": kill_target})
    constable = engine._constable_seat(state)
    if (
        constable is not None
        and state["alive"].get(str(constable))
        and state["phase"] == "night"
    ):
        gt = constable if gavel_target is None else gavel_target
        res = engine.apply_action(state, constable, "gavel", {"target": gt})
    if state["phase"] == "confess":
        res = skip_all_confess(engine, state)
    return res


# ---- registry / setup -------------------------------------------------------


def test_registered_in_catalog_contract():
    assert "salem" in ENGINES
    cls = get_engine("salem")
    assert cls.game_id == "salem"
    assert cls.name == "Salem 1692"
    assert cls.min_players == 4
    assert cls.max_players == 12


@pytest.mark.parametrize("n", [4, 5, 6, 7, 8, 9, 10, 11, 12])
def test_tryal_counts_match_table(engine, n):
    innocents, witches, constables = TRYAL_COUNTS[n]
    state = make_game(engine, n, seed=n * 10)
    ids = [c["id"] for row in state["tryals"].values() for c in row]
    assert ids.count(TRYAL_INNOCENT) == innocents
    assert ids.count(TRYAL_WITCH) == witches
    assert ids.count(TRYAL_CONSTABLE) == constables
    assert len(ids) == innocents + witches + constables
    per = len(ids) // n
    assert all(len(row) == per for row in state["tryals"].values())
    assert state["phase"] == "day"
    assert len(state["town_hall"]) == n


def test_n4_and_n12_tryal_counts(engine):
    s4 = make_game(engine, 4, seed=4)
    s12 = make_game(engine, 12, seed=12)
    assert sum(len(r) for r in s4["tryals"].values()) == 20
    assert all(len(r) == 5 for r in s4["tryals"].values())
    assert sum(len(r) for r in s12["tryals"].values()) == 36
    assert all(len(r) == 3 for r in s12["tryals"].values())
    w4 = [c["id"] for row in s4["tryals"].values() for c in row].count(TRYAL_WITCH)
    w12 = [c["id"] for row in s12["tryals"].values() for c in row].count(TRYAL_WITCH)
    assert w4 == 1
    assert w12 == 2


def test_seeing_own_witch_tryal_makes_you_a_witch(engine):
    state = make_game(engine, 4, seed=2)
    holders = []
    for s, row in state["tryals"].items():
        if any(c["id"] == TRYAL_WITCH for c in row):
            holders.append(int(s))
    assert sorted(state["witches"]) == sorted(holders)
    for h in holders:
        you = engine.visible_state(state, h)["you"]
        assert you["is_witch"] is True
        assert TRYAL_WITCH in [c["id"] for c in you["tryals"]]


# ---- hidden info ------------------------------------------------------------


def test_citizen_and_spectator_cannot_see_others_tryals_hands_or_night_votes(engine):
    state = make_game(engine, 4, seed=3)
    witch = witches_of(state)[0]
    town = [s for s in range(4) if s not in state["witches"]][0]

    spec = engine.visible_state(state, None)
    assert spec["you"] is None
    assert "hands" not in spec
    assert "witches" not in spec
    assert "night_kills" not in spec
    for s, pub in spec["tryals"].items():
        assert set(pub) == {"revealed", "facedown", "unrevealed"}
        assert pub["facedown"] == len(state["tryals"][s])
        assert pub["unrevealed"] == list(range(len(state["tryals"][s])))
        assert pub["revealed"] == []

    cv = engine.visible_state(state, town)
    assert cv["you"]["is_witch"] is False
    assert "teammates" not in cv["you"]
    assert cv["you"]["hand"] == state["hands"][str(town)]
    assert cv["you"]["tryals"] == [
        {"id": c["id"], "revealed": c["revealed"]} for c in state["tryals"][str(town)]
    ]
    # Must not dump other hands / identities / night votes
    assert "hands" not in cv
    assert "night_kills" not in cv
    other = [s for s in range(4) if s != town][0]
    other_ids = {c["id"] for c in state["tryals"][str(other)] if not c["revealed"]}
    dumped = str(cv)
    # public facedown is a count, not ids
    for tid in other_ids:
        # a town player may coincidentally share a tryal id (innocent is common)
        if tid == TRYAL_WITCH:
            assert tid not in [c["id"] for c in cv["you"]["tryals"]]
            assert "tryal_witch" not in dumped or witch == town

    play(engine, state, state["current_seat"], "night")
    engine.apply_action(state, witch, "night_kill", {"target": town})
    wv = engine.visible_state(state, witch)
    assert wv["you"]["my_night_kill"] == town
    tv = engine.visible_state(state, town)
    assert tv["you"].get("my_night_kill") in (None,)
    assert "night_kills" not in tv
    spec2 = engine.visible_state(state, None)
    assert spec2["you"] is None
    assert spec2["phase"] == "night"


def test_dead_player_has_you_but_no_night_actions(engine):
    state = make_game(engine, 4, seed=5)
    witch = witches_of(state)[0]
    town = [s for s in range(4) if s != witch]
    victim = town[0]
    # Reveal constable so gavel is not required.
    cs, ci = find_tryal(state, TRYAL_CONSTABLE)
    state["tryals"][str(cs)][ci]["revealed"] = True
    run_night(engine, state, kill_target=victim)
    assert state["alive"][str(victim)] is False
    vis = engine.visible_state(state, victim)
    assert vis["you"]["alive"] is False
    assert vis["you"]["seat"] == victim
    assert "my_night_kill" not in vis["you"]
    assert "my_gavel" not in vis["you"]
    with pytest.raises(IllegalAction, match="Dead"):
        engine.apply_action(state, victim, "play_card", {"card_id": "alibi", "target": victim})


# ---- day: 7 marks -----------------------------------------------------------


def test_seven_marks_reveals_chosen_tryal(engine):
    state = make_game(engine, 4, seed=6)
    strip_abilities(state)
    actor = state["current_seat"]
    target = (actor + 1) % 4
    idx = engine._unrevealed_indexes(state, target)[1]
    card_id = state["tryals"][str(target)][idx]["id"]
    state["marks"][str(target)] = 6
    res = play(engine, state, actor, "accusation", target=target, extra={"tryal_index": idx})
    assert state["tryals"][str(target)][idx]["revealed"] is True
    assert state["marks"][str(target)] == 0
    assert state["last_reveal"] == {"seat": target, "index": idx, "id": card_id}
    types = [e["type"] for e in res.events]
    assert "card_played" in types
    assert "tryal_revealed" in types
    revealed_ev = next(e for e in res.events if e["type"] == "tryal_revealed")
    assert revealed_ev["payload"]["id"] == card_id
    pub = engine.visible_state(state, None)
    assert card_id in pub["tryals"][str(target)]["revealed"]
    assert pub["tryals"][str(target)]["facedown"] == 4
    assert pub["tryals"][str(target)]["unrevealed"] == [0, 2, 3, 4]
    assert idx not in pub["tryals"][str(target)]["unrevealed"]


def test_alibi_clears_marks(engine):
    state = make_game(engine, 4, seed=7)
    actor = state["current_seat"]
    state["marks"]["1"] = 5
    play(engine, state, actor, "alibi", target=1)
    assert state["marks"]["1"] == 0


# ---- conspiracy -------------------------------------------------------------


def test_witch_sticky_after_conspiracy(engine):
    state = make_game(engine, 4, seed=8)
    # Seat 0 keeps a witch; seat 1 (left of seat 2? left of 1 is 0) takes it.
    # conspiracy_take from seat-1 wrap: seat 1 takes from seat 0.
    state["tryals"] = {
        "0": [
            {"id": TRYAL_WITCH, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "1": [
            {"id": TRYAL_INNOCENT, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "2": [
            {"id": TRYAL_INNOCENT, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "3": [
            {"id": TRYAL_INNOCENT, "revealed": False},
            {"id": TRYAL_CONSTABLE, "revealed": False},
        ],
    }
    state["witches"] = [0]
    play(engine, state, state["current_seat"], "conspiracy")
    assert state["phase"] == "conspiracy"
    # Each living player takes index 0 from the left.
    # 0 <- 3, 1 <- 0 (witch), 2 <- 1, 3 <- 2
    for s in range(4):
        engine.apply_action(state, s, "conspiracy_take", {"tryal_index": 0})
    assert state["phase"] == "day"
    assert 0 in state["witches"], "original witch stays sticky"
    assert 1 in state["witches"], "receiver of the witch tryal joins"
    ids1 = [c["id"] for c in state["tryals"]["1"]]
    assert TRYAL_WITCH in ids1
    ids0 = [c["id"] for c in state["tryals"]["0"]]
    assert TRYAL_WITCH not in ids0
    you0 = engine.visible_state(state, 0)["you"]
    you1 = engine.visible_state(state, 1)["you"]
    assert you0["is_witch"] is True
    assert you1["is_witch"] is True
    assert 0 in you1["teammates"] and 1 in you1["teammates"]


def test_constable_follows_the_card(engine):
    state = make_game(engine, 4, seed=9)
    state["tryals"] = {
        "0": [
            {"id": TRYAL_INNOCENT, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "1": [
            {"id": TRYAL_INNOCENT, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "2": [
            {"id": TRYAL_CONSTABLE, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
        "3": [
            {"id": TRYAL_WITCH, "revealed": False},
            {"id": TRYAL_INNOCENT, "revealed": False},
        ],
    }
    state["witches"] = [3]
    assert engine._constable_seat(state) == 2
    play(engine, state, state["current_seat"], "conspiracy")
    # Seat 3 takes from seat 2 → receives constable at index 0
    for s in range(4):
        engine.apply_action(state, s, "conspiracy_take", {"tryal_index": 0})
    assert engine._constable_seat(state) == 3
    assert engine.visible_state(state, 2)["you"]["is_constable"] is False
    assert engine.visible_state(state, 3)["you"]["is_constable"] is True
    assert engine.visible_state(state, 3)["you"]["is_witch"] is True  # sticky + holder


def test_conspiracy_take_is_secret_event(engine):
    state = make_game(engine, 4, seed=10)
    play(engine, state, state["current_seat"], "conspiracy")
    res = engine.apply_action(state, 0, "conspiracy_take", {"tryal_index": 0})
    assert res.events[0]["type"] == "conspiracy_take"
    assert res.events[0]["seat"] == 0


# ---- night + gavel ----------------------------------------------------------


def test_night_kill_and_gavel_save(engine):
    state = make_game(engine, 4, seed=11)
    strip_abilities(state)
    witch = witches_of(state)[0]
    constable = engine._constable_seat(state)
    assert constable is not None
    town = [s for s in range(4) if s != witch]
    victim = town[0] if town[0] != constable else town[1]
    play(engine, state, state["current_seat"], "night")
    for w in engine._alive_witches(state):
        engine.apply_action(state, w, "night_kill", {"target": victim})
    # mismatched gavel would not save; matching gavel saves
    engine.apply_action(state, constable, "gavel", {"target": victim})
    assert state["phase"] == "confess"
    assert state["confess_deadline"] is not None
    assert state["confess_deadline"] > time.time()
    skip_all_confess(engine, state)
    assert state["alive"][str(victim)] is True
    assert state["last_night"] == {"killed": None}
    for viewer in (witch, victim, constable, None):
        vis = engine.visible_state(state, viewer)
        assert vis["last_night"] == {"killed": None}


def test_night_kill_without_save(engine):
    state = make_game(engine, 4, seed=12)
    witch = witches_of(state)[0]
    # Reveal constable so gavel is not required.
    cs, ci = find_tryal(state, TRYAL_CONSTABLE)
    state["tryals"][str(cs)][ci]["revealed"] = True
    assert engine._constable_seat(state) is None
    victim = [s for s in range(4) if s != witch][0]
    res = run_night(engine, state, kill_target=victim)
    assert state["alive"][str(victim)] is False
    assert state["last_night"] == {"killed": victim}
    night_ev = [e for e in res.events if e["type"] == "night_resolved"]
    assert night_ev[0]["payload"] == {"killed": victim}
    assert "saved" not in night_ev[0]["payload"]
    # accusation scaling: remaining living each gained an accusation
    for s in engine._alive_seats(state):
        assert "accusation" in state["hands"][str(s)]


def test_night_kill_requires_witch_consensus(engine):
    state = make_game(engine, 6, seed=13)
    strip_abilities(state)
    # Plant two witches
    state["witches"] = [0, 1]
    state["tryals"]["0"][0] = {"id": TRYAL_WITCH, "revealed": False}
    state["tryals"]["1"][0] = {"id": TRYAL_WITCH, "revealed": False}
    cs, ci = find_tryal(state, TRYAL_CONSTABLE)
    state["tryals"][str(cs)][ci]["revealed"] = True
    play(engine, state, state["current_seat"], "night")
    engine.apply_action(state, 0, "night_kill", {"target": 2})
    res = engine.apply_action(state, 1, "night_kill", {"target": 3})
    assert state["phase"] == "night"
    assert res.finished is False
    engine.apply_action(state, 0, "night_kill", {"target": 3})
    assert state["phase"] == "confess"
    skip_all_confess(engine, state)
    assert state["alive"]["3"] is False
    assert state["alive"]["2"] is True


def test_citizen_cannot_night_kill(engine):
    state = make_game(engine, 4, seed=14)
    strip_abilities(state)
    witch = witches_of(state)[0]
    town = [s for s in range(4) if s != witch][0]
    play(engine, state, state["current_seat"], "night")
    with pytest.raises(IllegalAction, match="witches"):
        engine.apply_action(state, town, "night_kill", {"target": witch})


def test_tick_auto_skips_confess_after_deadline(engine):
    state = make_game(engine, 4, seed=15)
    strip_abilities(state)
    cs, ci = find_tryal(state, TRYAL_CONSTABLE)
    state["tryals"][str(cs)][ci]["revealed"] = True
    witch = witches_of(state)[0]
    victim = [s for s in range(4) if s != witch][0]
    play(engine, state, state["current_seat"], "night")
    engine.apply_action(state, witch, "night_kill", {"target": victim})
    assert state["phase"] == "confess"
    # Deadline not passed → no-op
    res = engine.apply_action(state, 0, "tick", {})
    assert state["phase"] == "confess"
    assert res.events == []
    state["confess_deadline"] = time.time() - 1
    res = engine.apply_action(state, 0, "tick", {})
    assert state["last_night"]["killed"] == victim
    assert state["phase"] in ("day", "over")


# ---- wins -------------------------------------------------------------------


def test_town_wins_when_every_witch_tryal_is_revealed(engine):
    state = make_game(engine, 4, seed=16)
    strip_abilities(state)
    witch_seat, idx = find_tryal(state, TRYAL_WITCH)
    actor = state["current_seat"]
    state["marks"][str(witch_seat)] = 6
    res = play(
        engine, state, actor, "accusation", target=witch_seat, extra={"tryal_index": idx}
    )
    assert res.finished is True
    assert res.result["reason"] == "town_won"
    assert res.result["winner_role"] == "town"
    assert "roles" in res.result
    assert "tryals" in res.result
    assert res.result["roles"][str(witch_seat)] == "witch"
    vis = engine.visible_state(state, None)
    assert vis["phase"] == "over"
    assert vis["result"]["tryals"][str(witch_seat)][idx]["revealed"] is True


def test_witches_win_when_no_living_town_remains(engine):
    state = make_game(engine, 4, seed=17)
    witch = witches_of(state)[0]
    town = [s for s in range(4) if s != witch]
    cs, ci = find_tryal(state, TRYAL_CONSTABLE)
    state["tryals"][str(cs)][ci]["revealed"] = True
    # Kill two town by mutating, then night-kill the last one through the engine.
    state["alive"][str(town[0])] = False
    state["alive"][str(town[1])] = False
    last = town[2]
    state["current_seat"] = witch
    res = run_night(engine, state, kill_target=last)
    assert res.finished is True
    assert res.result["reason"] == "witches_won"
    assert res.result["winner_role"] == "witches"
    assert witch in res.result["winner_seats"]
    assert set(res.result["roles"]) == {"0", "1", "2", "3"}
    assert "tryals" in res.result


def test_game_over_rejects_further_actions(engine):
    state = make_game(engine, 4, seed=18)
    state["phase"] = "over"
    state["result"] = {"reason": "town_won"}
    with pytest.raises(IllegalAction, match="over"):
        engine.apply_action(state, 0, "play_card", {"card_id": "alibi", "target": 0})


# ---- illegal / contract -----------------------------------------------------


def test_play_card_requires_your_turn_and_the_card(engine):
    state = make_game(engine, 4, seed=19)
    current = state["current_seat"]
    other = (current + 1) % 4
    with pytest.raises(IllegalAction, match="not your turn"):
        engine.apply_action(
            state, other, "play_card", {"card_id": "alibi", "target": other}
        )
    state["hands"][str(current)] = ["accusation"]
    with pytest.raises(IllegalAction, match="do not have"):
        engine.apply_action(
            state, current, "play_card", {"card_id": "alibi", "target": current}
        )


def test_black_cat_then_conspiracy_reveals_holder_tryal(engine):
    state = make_game(engine, 4, seed=20)
    actor = state["current_seat"]
    holder = (actor + 1) % 4
    # Avoid sealed_row characters blocking the peek in this test.
    for s in range(4):
        state["town_hall"][str(s)] = {"id": "crowd_voice", "name": "Crowd Voice"}
    play(engine, state, actor, "black_cat", target=holder)
    play(engine, state, state["current_seat"], "conspiracy")
    assert state["last_reveal"]["seat"] == holder
    assert state["tryals"][str(holder)][state["last_reveal"]["index"]]["revealed"] is True
    assert state["phase"] == "conspiracy"


def test_visible_state_public_keys_and_you_contract(engine):
    state = make_game(engine, 4, seed=21)
    vis = engine.visible_state(state, 0)
    for key in (
        "phase",
        "round",
        "alive",
        "town_hall",
        "marks",
        "tryals",
        "blues",
        "deck_left",
        "discard_top",
        "last_night",
        "last_reveal",
        "confess_deadline",
        "result",
        "you",
    ):
        assert key in vis
    you = vis["you"]
    for key in ("seat", "hand", "tryals", "is_witch", "is_constable", "alive"):
        assert key in you
    spec = engine.visible_state(state, None)
    assert spec["you"] is None


def test_resolve_if_ready_helper_is_callable(engine):
    state = make_game(engine, 4, seed=22)
    play(engine, state, state["current_seat"], "conspiracy")
    engine.apply_action(state, 0, "conspiracy_take", {"tryal_index": 0})
    res = engine.resolve_if_ready(state, [])
    assert res.finished is False
    assert state["phase"] == "conspiracy"


def test_scapegoat_moves_marks_from_from_seat(engine):
    state = make_game(engine, 4, seed=11)
    strip_abilities(state)
    actor = state["current_seat"]
    source = (actor + 1) % 4
    dest = (actor + 2) % 4
    state["marks"][str(source)] = 4
    state["marks"][str(dest)] = 1
    play(engine, state, actor, "scapegoat", target=dest, extra={"from_seat": source})
    assert state["marks"][str(source)] == 0
    assert state["marks"][str(dest)] == 5


def test_scapegoat_requires_from_seat(engine):
    state = make_game(engine, 4, seed=12)
    actor = state["current_seat"]
    dest = (actor + 1) % 4
    with pytest.raises(IllegalAction, match="from_seat"):
        play(engine, state, actor, "scapegoat", target=dest)


def test_constable_can_gavel_self(engine):
    state = make_game(engine, 4, seed=13)
    strip_abilities(state)
    constable = engine._constable_seat(state)
    witch = witches_of(state)[0]
    play(engine, state, state["current_seat"], "night")
    engine.apply_action(state, witch, "night_kill", {"target": constable})
    engine.apply_action(state, constable, "gavel", {"target": constable})
    skip_all_confess(engine, state)
    assert state["alive"][str(constable)] is True
    assert state["last_night"]["killed"] is None


# ---- Town Hall 2-pick (n<=7) ------------------------------------------------


def test_n8_auto_assigns_town_hall(engine):
    state = engine.init_state({"seed": 80}, [f"u{i}" for i in range(8)])
    assert state["phase"] == "day"
    assert all(state["town_hall"][str(i)] is not None for i in range(8))
    vis = engine.visible_state(state, 0)
    assert vis["you"]["town_hall_options"] == []
    with pytest.raises(IllegalAction, match="already assigned"):
        engine.apply_action(state, 0, "choose_town_hall", {"character_id": "iron_will"})


def test_n4_starts_in_town_hall_pick(engine):
    state = engine.init_state({"seed": 4}, [f"u{i}" for i in range(4)])
    assert state["phase"] == "town_hall"
    assert all(state["town_hall"][str(i)] is None for i in range(4))
    mine = engine.visible_state(state, 0)
    other = engine.visible_state(state, 1)
    spec = engine.visible_state(state, None)
    assert len(mine["you"]["town_hall_options"]) == 2
    assert other["you"]["town_hall_options"] != mine["you"]["town_hall_options"]
    assert spec["you"] is None
    assert spec["town_hall"]["0"] is None
    ids = {o["id"] for o in mine["you"]["town_hall_options"]}
    assert "town_hall_options" not in spec
    assert "town_hall_options" not in other
    # Options stay on you only — other seats get a different pair.
    assert set(ids).isdisjoint({o["id"] for o in other["you"]["town_hall_options"]})


def test_choose_town_hall_rejects_foreign_id(engine):
    state = engine.init_state({"seed": 5}, [f"u{i}" for i in range(4)])
    mine = {o["id"] for o in state["town_hall_options"]["0"]}
    foreign = next(cid for cid in ("iron_will", "card_cache", "crowd_voice") if cid not in mine)
    with pytest.raises(IllegalAction, match="not one of your Town Hall options"):
        engine.apply_action(state, 0, "choose_town_hall", {"character_id": foreign})


def test_choose_town_hall_resolves_to_day(engine):
    state = engine.init_state({"seed": 6}, [f"u{i}" for i in range(4)])
    picks = []
    for s in range(4):
        cid = state["town_hall_options"][str(s)][1]["id"]
        picks.append(cid)
        res = engine.apply_action(state, s, "choose_town_hall", {"character_id": cid})
        if s < 3:
            assert state["phase"] == "town_hall"
            assert any(e["type"] == "town_hall_chosen" for e in res.events)
            assert not any(e["type"] == "day_started" for e in res.events)
        else:
            assert state["phase"] == "day"
            assert any(e["type"] == "day_started" for e in res.events)
    assert [state["town_hall"][str(s)]["id"] for s in range(4)] == picks
    vis = engine.visible_state(state, 0)
    assert vis["you"]["town_hall_options"] == []
    assert vis["town_hall"]["0"]["id"] == picks[0]


def test_first_light_applies_after_all_picks(engine):
    state = engine.init_state({"seed": 7}, [f"u{i}" for i in range(7)])
    assert state["phase"] == "town_hall"
    first_light_seat = None
    for s in range(7):
        opts = state["town_hall_options"][str(s)]
        pick = next((o["id"] for o in opts if o["id"] == "first_light"), opts[0]["id"])
        if pick == "first_light":
            first_light_seat = s
        engine.apply_action(state, s, "choose_town_hall", {"character_id": pick})
    assert state["phase"] == "day"
    if first_light_seat is not None:
        assert state["current_seat"] == first_light_seat
