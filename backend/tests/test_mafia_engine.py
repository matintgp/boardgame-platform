import pytest

from app.games.base import IllegalAction
from app.games.mafia_engine import MafiaEngine

N = 5  # 1 mafia, 1 doctor, 3 citizens


@pytest.fixture
def engine():
    return MafiaEngine()


def make_game(engine, n=N):
    seats = [f"user-{i}" for i in range(n)]
    state = engine.init_state({}, seats)
    roles = state["roles"]
    mafia = int(next(s for s, r in roles.items() if r == "mafia"))
    doctor = int(next(s for s, r in roles.items() if r == "doctor"))
    citizens = [int(s) for s, r in roles.items() if r == "citizen"]
    return state, mafia, doctor, citizens


def test_role_distribution(engine):
    state, mafia, doctor, citizens = make_game(engine)
    assert state["roles"][str(mafia)] == "mafia"
    assert state["roles"][str(doctor)] == "doctor"
    assert len(citizens) == 3
    # hidden-info: a citizen's view must not contain the mafia seat list
    v = engine.visible_state(state, citizens[0])
    assert "teammates" not in v["you"]
    # mafia view DOES include teammates
    vm = engine.visible_state(state, mafia)
    assert vm["you"]["teammates"] == [mafia]


def test_night_requires_mafia_action(engine):
    state, mafia, doctor, citizens = make_game(engine)
    # doctor alone cannot resolve the night
    res = engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    assert res.finished is False
    assert state["phase"] == "night"
    # citizen cannot kill
    with pytest.raises(IllegalAction):
        engine.apply_action(state, citizens[0], "mafia_kill", {"target": doctor})
    # mafia kills a citizen -> night resolves -> day
    res = engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    assert state["phase"] == "day"
    assert state["alive"][str(citizens[0])] is False
    night_ev = [e for e in res.events if e["type"] == "night_resolved"]
    assert night_ev[0]["payload"]["killed"] == citizens[0]


def test_doctor_save_prevents_death(engine):
    state, mafia, doctor, citizens = make_game(engine)
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": victim})
    engine.apply_action(state, mafia, "mafia_kill", {"target": victim})
    assert state["alive"][str(victim)] is True
    assert state["last_night"] == {"killed": None, "saved": True}


def test_day_vote_eliminates_and_can_end_game(engine):
    state, mafia, doctor, citizens = make_game(engine)
    # night: mafia kills citizen0, doctor saves self
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    # day: ALL alive players (including mafia) vote for the mafia
    voters = [mafia, doctor] + citizens[1:]
    res = None
    for v in voters[:-1]:
        res = engine.apply_action(state, v, "vote", {"target": mafia})
        assert res.finished is False
        assert state["phase"] == "day"
    res = engine.apply_action(state, voters[-1], "vote", {"target": mafia})
    assert res.finished is True
    assert res.result["reason"] == "citizens_won"
    assert state["alive"][str(mafia)] is False


def test_mafia_win_when_outnumbered(engine):
    state, mafia, doctor, citizens = make_game(engine)
    # kill two citizens over two nights; day votes eliminate nobody (tie)
    for victim in citizens[:2]:
        engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
        engine.apply_action(state, mafia, "mafia_kill", {"target": victim})
        alive = engine._alive_seats(state)
        # tie votes: half vote one way, half the other -> no elimination
        half = len(alive) // 2
        for i, v in enumerate(alive):
            engine.apply_action(state, v, "vote", {"target": alive[0] if i < half else alive[-1]})
    assert state["result"]["reason"] == "mafia_won"
    assert state["result"]["winner_seats"] == [mafia]


def test_dead_cannot_vote_or_act(engine):
    state, mafia, doctor, citizens = make_game(engine)
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    with pytest.raises(IllegalAction):
        engine.apply_action(state, citizens[0], "vote", {"target": mafia})
