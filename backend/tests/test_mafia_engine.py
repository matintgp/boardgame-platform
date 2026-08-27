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
    mafias = sorted(int(s) for s, r in roles.items() if r == "mafia")
    doctor = int(next(s for s, r in roles.items() if r == "doctor"))
    citizens = sorted(int(s) for s, r in roles.items() if r == "citizen")
    return state, mafias, doctor, citizens


def _assert_no_role_leak(view, *, expect_you: bool):
    assert "roles" not in view
    if expect_you:
        assert view["you"] is not None
        assert "teammates" not in view["you"] or view["you"]["role"] == "mafia"
    else:
        assert view["you"] is None
    if view.get("last_night") is not None:
        assert "saved" not in view["last_night"]
        assert set(view["last_night"]) <= {"killed"}


def _tie_day(engine, state):
    """Force a no-elim day: even split, or everyone votes for themself when odd."""
    alive = engine._alive_seats(state)
    n = len(alive)
    res = None
    if n % 2 == 1:
        for v in alive:
            res = engine.apply_action(state, v, "vote", {"target": v})
    else:
        a, b = alive[0], alive[-1]
        half = n // 2
        for i, v in enumerate(alive):
            res = engine.apply_action(state, v, "vote", {"target": a if i < half else b})
    return res


def _majority_vote(engine, state, target):
    alive = engine._alive_seats(state)
    res = None
    for v in alive:
        res = engine.apply_action(state, v, "vote", {"target": target})
    return res


@pytest.mark.parametrize(
    "n,mafia_n,citizen_n",
    [
        (4, 1, 2),
        (5, 1, 3),
        (6, 2, 3),
        (8, 2, 5),
    ],
)
def test_role_counts(engine, n, mafia_n, citizen_n):
    state, mafias, doctor, citizens = make_game(engine, n)
    assert len(mafias) == mafia_n
    assert len(citizens) == citizen_n
    assert state["roles"][str(doctor)] == "doctor"
    assert sum(1 for r in state["roles"].values() if r == "doctor") == 1
    assert len(state["roles"]) == n
    assert set(state["roles"].values()) <= {"mafia", "doctor", "citizen"}


def test_role_distribution(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    assert state["roles"][str(mafia)] == "mafia"
    assert state["roles"][str(doctor)] == "doctor"
    assert len(citizens) == 3
    # hidden-info: a citizen's view must not contain the mafia seat list
    v = engine.visible_state(state, citizens[0])
    assert "teammates" not in v["you"]
    # mafia view DOES include teammates
    vm = engine.visible_state(state, mafia)
    assert vm["you"]["teammates"] == mafias


def test_night_requires_mafia_action(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
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
    assert "saved" not in night_ev[0]["payload"]


def test_two_mafia_must_both_submit_before_night_resolves(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    assert len(mafias) == 2
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    res = engine.apply_action(state, mafias[0], "mafia_kill", {"target": victim})
    assert res.finished is False
    assert state["phase"] == "night"
    assert state["alive"][str(victim)] is True
    v0 = engine.visible_state(state, mafias[0])
    v1 = engine.visible_state(state, mafias[1])
    assert v0["you"]["my_action"] == victim
    assert v1["you"]["my_action"] is None
    assert v0["you"]["team_ready"] is False
    assert v1["you"]["team_ready"] is False

    res = engine.apply_action(state, mafias[1], "mafia_kill", {"target": victim})
    assert state["phase"] == "day"
    assert state["alive"][str(victim)] is False
    night_ev = [e for e in res.events if e["type"] == "night_resolved"]
    assert night_ev[0]["payload"]["killed"] == victim


def test_two_mafia_mismatched_targets_do_not_resolve(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    a, b = citizens[0], citizens[1]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": a})
    res = engine.apply_action(state, mafias[1], "mafia_kill", {"target": b})
    assert res.finished is False
    assert state["phase"] == "night"
    assert state["alive"][str(a)] is True
    assert state["alive"][str(b)] is True
    v0 = engine.visible_state(state, mafias[0])
    v1 = engine.visible_state(state, mafias[1])
    assert v0["you"]["my_action"] == a
    assert v1["you"]["my_action"] == b
    assert v0["you"]["team_ready"] is False

    # first mafia re-submits to match → night resolves on the agreed target
    res = engine.apply_action(state, mafias[0], "mafia_kill", {"target": b})
    assert state["phase"] == "day"
    assert state["alive"][str(a)] is True
    assert state["alive"][str(b)] is False
    you = engine.visible_state(state, mafias[0])["you"]
    assert "team_ready" not in you  # day phase does not expose night team_ready


def test_matching_mafia_targets_resolve_with_doctor(engine):
    state, mafias, doctor, citizens = make_game(engine, 8)
    victim = citizens[0]
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": victim})
    engine.apply_action(state, mafias[1], "mafia_kill", {"target": victim})
    assert state["phase"] == "night"  # doctor has not acted
    res = engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    assert state["phase"] == "day"
    assert state["alive"][str(victim)] is False
    assert [e for e in res.events if e["type"] == "night_resolved"]


def test_doctor_save_prevents_death(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": victim})
    engine.apply_action(state, mafia, "mafia_kill", {"target": victim})
    assert state["alive"][str(victim)] is True
    assert state["last_night"] == {"killed": None}
    # public views: nobody died, no extra save-success leak
    for viewer in (citizens[1], mafia, doctor, None):
        vis = engine.visible_state(state, viewer)
        assert vis["last_night"] == {"killed": None}
        assert "saved" not in vis["last_night"]
        if vis["log"]:
            assert "saved" not in vis["log"][-1]
    # doctor still knows their own save target only via my_action *during* night
    assert engine.visible_state(state, doctor)["you"].get("my_action") is None


def test_day_vote_eliminates_and_can_end_game(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
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
    assert res.result["roles"] == state["roles"]
    assert "mafia" in res.result["roles"].values()


def test_day_majority_eliminates(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    # 4 alive: 3 vote mafia, 1 (mafia) votes doctor → majority/plurality
    alive = engine._alive_seats(state)
    assert len(alive) == 4
    others = [s for s in alive if s != mafia]
    for s in others:
        engine.apply_action(state, s, "vote", {"target": mafia})
    res = engine.apply_action(state, mafia, "vote", {"target": doctor})
    assert state["last_vote"]["eliminated"] == mafia
    assert state["last_vote"]["tie"] is False
    assert state["last_vote"]["role"] == "mafia"
    assert res.finished is True
    assert res.result["reason"] == "citizens_won"


def test_day_tie_eliminates_nobody(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    # 4 alive: 2-2 split
    res = _tie_day(engine, state)
    assert res.finished is False
    assert state["phase"] == "night"
    assert state["round"] == 2
    assert state["last_vote"]["eliminated"] is None
    assert state["last_vote"]["tie"] is True
    assert state["last_vote"]["role"] is None
    for s in engine._alive_seats(state):
        assert state["alive"][str(s)] is True


def test_mafia_win_when_outnumbered(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    # 1 mafia vs 4 town. Two night kills + ties leave 1 vs 2; third kill ties the
    # living count (1 mafia >= 1 town) and mafia wins.
    for victim in citizens[:2]:
        engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
        engine.apply_action(state, mafia, "mafia_kill", {"target": victim})
        res = _tie_day(engine, state)
        assert res.finished is False
        assert state["phase"] == "night"
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    res = engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[2]})
    assert res.finished is True
    assert state["result"]["reason"] == "mafia_won"
    assert state["result"]["winner_seats"] == mafias
    assert state["result"]["roles"] == state["roles"]


def test_citizens_won_includes_role_map(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    res = _majority_vote(engine, state, mafia)
    assert res.finished is True
    assert res.result["reason"] == "citizens_won"
    assert res.result["winner_role"] == "citizens"
    assert mafia not in res.result["winner_seats"]
    assert doctor in res.result["winner_seats"]
    assert set(res.result["roles"]) == set(state["roles"])


def test_dead_cannot_vote_or_act(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    with pytest.raises(IllegalAction):
        engine.apply_action(state, citizens[0], "vote", {"target": mafia})
    # after a tie they would go to night; kill doctor and ensure dead doctor cannot save
    _tie_day(engine, state)
    assert state["phase"] == "night"
    engine.apply_action(state, mafia, "mafia_kill", {"target": doctor})
    # doctor is still alive this night (kill hasn't resolved without doctor save)
    # doctor saves self so the kill of doctor is prevented... instead kill remaining citizen
    # reset: doctor is alive. Have doctor save self, mafia kills remaining living citizen[1]
    # Wait: we already applied mafia_kill targeting doctor. Doctor must still save.
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    assert state["phase"] == "day"
    assert state["alive"][str(doctor)] is True
    dead = citizens[0]
    with pytest.raises(IllegalAction):
        engine.apply_action(state, dead, "vote", {"target": mafia})


def test_dead_cannot_act_at_night(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": victim})
    engine.apply_action(state, mafias[1], "mafia_kill", {"target": victim})
    assert state["alive"][str(victim)] is False
    _tie_day(engine, state)
    assert state["phase"] == "night"
    with pytest.raises(IllegalAction):
        engine.apply_action(state, victim, "mafia_kill", {"target": doctor})
    with pytest.raises(IllegalAction):
        engine.apply_action(state, victim, "doctor_save", {"target": victim})


def test_dead_player_still_gets_you_with_role(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": victim})
    vis = engine.visible_state(state, victim)
    assert vis["you"]["seat"] == victim
    assert vis["you"]["role"] == "citizen"
    assert vis["you"]["alive"] is False
    assert "teammates" not in vis["you"]


def test_hidden_info_citizen_spectator_mafia(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    citizen = citizens[0]
    cv = engine.visible_state(state, citizen)
    _assert_no_role_leak(cv, expect_you=True)
    assert cv["you"]["role"] == "citizen"
    assert "teammates" not in cv["you"]
    assert "mafia_votes" not in cv
    assert set(cv["you"]) <= {"seat", "role", "alive", "my_action", "team_ready", "my_vote", "votes_in", "votes_needed"}

    spec = engine.visible_state(state, None)
    _assert_no_role_leak(spec, expect_you=False)
    assert "roles" not in spec
    assert spec["you"] is None

    mv = engine.visible_state(state, mafias[0])
    assert mv["you"]["role"] == "mafia"
    assert sorted(mv["you"]["teammates"]) == mafias
    assert "roles" not in mv
    # mafia must not see the doctor's identity via public fields
    assert mv["you"].get("my_action") is None

    dv = engine.visible_state(state, doctor)
    assert dv["you"]["role"] == "doctor"
    assert "teammates" not in dv["you"]
    assert "roles" not in dv


def test_game_over_result_includes_role_reveal(engine):
    state, mafias, doctor, citizens = make_game(engine)
    mafia = mafias[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafia, "mafia_kill", {"target": citizens[0]})
    res = _majority_vote(engine, state, mafia)
    assert res.finished is True
    roles = res.result["roles"]
    assert roles == state["roles"]
    assert len(roles) == N

    for viewer in (mafia, doctor, citizens[0], citizens[1], None):
        vis = engine.visible_state(state, viewer)
        assert vis["result"]["roles"] == roles
        # still no top-level roles dump except via result
        assert "roles" not in vis or vis.get("roles") is vis["result"].get("roles")
        if viewer is None:
            assert vis["you"] is None
        else:
            assert vis["you"]["role"] == state["roles"][str(viewer)]
            assert vis["you"]["alive"] == state["alive"][str(viewer)]


def test_remaining_mafia_can_kill_after_partner_dies(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    # night 1: kill a citizen
    victim = citizens[0]
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": victim})
    engine.apply_action(state, mafias[1], "mafia_kill", {"target": victim})
    # day: majority votes out one mafia
    _majority_vote(engine, state, mafias[0])
    assert state["alive"][str(mafias[0])] is False
    assert state["phase"] == "night"
    with pytest.raises(IllegalAction):
        engine.apply_action(state, mafias[0], "mafia_kill", {"target": citizens[1]})
    # surviving mafia + doctor resolve night alone
    engine.apply_action(state, doctor, "doctor_save", {"target": doctor})
    res = engine.apply_action(state, mafias[1], "mafia_kill", {"target": citizens[1]})
    assert state["phase"] in ("day", "over")
    assert state["alive"][str(citizens[1])] is False
    night_ev = [e for e in res.events if e["type"] == "night_resolved"]
    assert night_ev[0]["payload"]["killed"] == citizens[1]


def test_night_resolves_without_doctor_if_doctor_is_dead(engine):
    state, mafias, doctor, citizens = make_game(engine, 6)
    # kill doctor on night 1 (doctor wastes the save on a citizen)
    engine.apply_action(state, doctor, "doctor_save", {"target": citizens[0]})
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": doctor})
    engine.apply_action(state, mafias[1], "mafia_kill", {"target": doctor})
    assert state["alive"][str(doctor)] is False
    _tie_day(engine, state)
    assert state["phase"] == "night"
    with pytest.raises(IllegalAction):
        engine.apply_action(state, doctor, "doctor_save", {"target": citizens[0]})
    engine.apply_action(state, mafias[0], "mafia_kill", {"target": citizens[0]})
    assert state["phase"] == "night"
    engine.apply_action(state, mafias[1], "mafia_kill", {"target": citizens[0]})
    assert state["phase"] in ("day", "over")
    assert state["alive"][str(citizens[0])] is False
    assert state["last_night"] == {"killed": citizens[0]}
