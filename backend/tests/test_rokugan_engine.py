import pytest

from app.games.base import IllegalAction
from app.games.rokugan_engine import RokuganEngine

SEATS = ["user-a", "user-b"]


@pytest.fixture
def engine():
    return RokuganEngine()


@pytest.fixture
def state(engine):
    return engine.init_state({}, SEATS)


def plan_payload(a_target=0, a_token=3, d_target=0, d_token=4):
    return {
        "attack": {"target": a_target, "token": a_token},
        "defense": {"target": d_target, "token": d_token},
    }


def test_plan_submission_and_hidden_info(engine, state):
    res = engine.apply_action(state, 0, "plan", plan_payload())
    assert not res.finished
    # seat 0 sees own plan; seat 1 must NOT see it, only a "submitted" flag
    v0 = engine.visible_state(state, 0)
    assert v0["you"]["plan"]["attack"]["token"] == 3
    v1 = engine.visible_state(state, 1)
    assert v1["you"]["plan"] is None
    assert v1["opponent"]["submitted"] is True
    # spectator sees neither plan
    vs = engine.visible_state(state, None)
    assert vs["you"] is None and vs["opponent"] is None


def test_resolution_razes_undefended_province(engine, state):
    engine.apply_action(state, 0, "plan", plan_payload(a_target=1, a_token=5, d_target=0, d_token=4))
    res = engine.apply_action(state, 1, "plan", plan_payload(a_target=0, a_token=2, d_target=2, d_token=3))
    assert res.finished is False
    # seat 0 attacked province 1 of seat 1 with 5 vs no defense (seat 1 defended own 2)
    assert state["provinces"]["1"][1] is True
    assert state["provinces"]["0"][0] is False  # 2 vs 4 -> defended
    assert state["round"] == 2
    reveal = [e for e in res.events if e["type"] == "reveal"]
    assert len(reveal) == 1


def test_cannot_attack_razed_or_reuse_token(engine, state):
    state["provinces"]["1"][0] = True
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 0, "plan", plan_payload(a_target=0))
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 0, "plan", plan_payload(a_token=3, d_token=3))


def test_win_by_razing_two_provinces(engine, state):
    state["provinces"]["1"][0] = True  # one already razed
    engine.apply_action(state, 0, "plan", plan_payload(a_target=1, a_token=5, d_target=0, d_token=1))
    res = engine.apply_action(state, 1, "plan", plan_payload(a_target=0, a_token=1, d_target=1, d_token=2))
    assert res.finished is True
    assert res.result["winner_seat"] == 0  # seat 1 now has 2 razed provinces
    assert state["phase"] == "over"
    over = [e for e in res.events if e["type"] == "game_over"]
    assert len(over) == 1


def test_draw_after_max_rounds(engine, state):
    state["round"] = 5
    engine.apply_action(state, 0, "plan", plan_payload(a_target=0, a_token=1, d_target=0, d_token=5))
    res = engine.apply_action(state, 1, "plan", plan_payload(a_target=0, a_token=1, d_target=0, d_token=5))
    assert res.finished is True
    assert res.result["winner_seat"] is None
    assert res.result["reason"] == "rounds_complete"


def test_no_actions_after_game_over(engine, state):
    state["phase"] = "over"
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 0, "plan", plan_payload())
