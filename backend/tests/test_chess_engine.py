from app.games.chess_engine import ChessEngine
from app.games.base import IllegalAction
import pytest

SEATS = ["user-a", "user-b"]


@pytest.fixture
def engine():
    return ChessEngine()


@pytest.fixture
def state(engine):
    return engine.init_state({}, SEATS)


def test_initial_state(engine, state):
    vis = engine.visible_state(state, 0)
    assert vis["turn_seat"] == 0
    assert vis["fen"].split()[1] == "w"
    assert len(vis["legal_moves"]) == 20


def test_legal_opening_move(engine, state):
    result = engine.apply_action(state, 0, "move", {"move": "e2e4"})
    assert not result.finished
    assert result.events[0]["payload"]["san"] == "e4"
    assert engine.visible_state(state, 1)["turn_seat"] == 1


def test_wrong_turn_rejected(engine, state):
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 1, "move", {"move": "e7e5"})


def test_illegal_move_rejected(engine, state):
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 0, "move", {"move": "e2e5"})


def test_malformed_move_rejected(engine, state):
    with pytest.raises(IllegalAction):
        engine.apply_action(state, 0, "move", {"move": "hello"})


def test_fools_mate_finishes_game(engine, state):
    moves = [
        (0, "f2f3"),
        (1, "e7e5"),
        (0, "g2g4"),
        (1, "d8h4"),
    ]
    result = None
    for seat, move in moves:
        result = engine.apply_action(state, seat, "move", {"move": move})
    assert result is not None and result.finished
    assert result.result == {"reason": "checkmate", "winner_seat": 1}
    vis = engine.visible_state(state, 0)
    assert vis["result"]["winner_seat"] == 1


def test_stalemate_detection(engine):
    """Ladder to a known stalemate position via FEN sanity check."""
    eng = ChessEngine()
    state = {
        "fen": "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
        "san_history": [],
    }
    # Black is stalemated only if not in check; here black king h8, Qf7, Kg6 => stalemate.
    vis = eng.visible_state(state, 1)
    assert vis["result"]["winner_seat"] is None
    assert vis["result"]["reason"] == "stalemate"


def test_spectator_gets_no_legal_moves_midgame(engine, state):
    engine.apply_action(state, 0, "move", {"move": "e2e4"})
    vis = engine.visible_state(state, None)
    assert vis["legal_moves"] is None or vis["legal_moves"] == []
