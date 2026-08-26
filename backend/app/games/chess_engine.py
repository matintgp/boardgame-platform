"""Chess engine built on python-chess. Perfect information: visible == full state.

Clocks: each player has a total thinking time (default 10 minutes). The clock
of the side to move ticks in real time (settled on every action + by the
server's timer loop); at 0:00 that side loses on timeout.
"""

import random
import time
from typing import Any, ClassVar

import chess

from app.games.base import ApplyResult, BaseEngine, IllegalAction


class ChessEngine(BaseEngine):
    game_id: ClassVar[str] = "chess"
    name: ClassVar[str] = "Chess"
    min_players: ClassVar[int] = 2
    max_players: ClassVar[int] = 2

    CLOCK_SECONDS: ClassVar[float] = 600.0  # 10 minutes per player

    def init_state(self, config: dict, seats: list[str]) -> dict:
        return {
            "fen": chess.STARTING_FEN,
            "san_history": [],
            # seat 0 plays White, seat 1 plays Black
            "clocks": {"0": self.CLOCK_SECONDS, "1": self.CLOCK_SECONDS},
            "turn_started_at": time.time(),
            "paused": None,  # {"seat": int, "since": float} while turn player offline
            "result": None,
        }

    def turn_seat(self, state: dict) -> int:
        board = chess.Board(state["fen"])
        return 0 if board.turn == chess.WHITE else 1

    def _settle_clock(self, state: dict, now: float | None = None) -> dict | None:
        """Deduct elapsed time from the side to move. Returns timeout result or None."""
        if state.get("paused") or state.get("result"):
            return None
        started = state.get("turn_started_at")
        if started is None:
            return None
        now = now or time.time()
        turn = str(self.turn_seat(state))
        state["clocks"][turn] = state["clocks"].get(turn, self.CLOCK_SECONDS) - (now - started)
        state["turn_started_at"] = now
        if state["clocks"][turn] <= 0:
            state["clocks"][turn] = 0
            result = {"reason": "timeout", "winner_seat": 1 - int(turn)}
            state["result"] = result
            return result
        return None

    def apply_action(
        self, state: dict, seat: int, action_type: str, payload: dict
    ) -> ApplyResult:
        if action_type != "move":
            raise IllegalAction(f"Unknown action '{action_type}' for chess")
        if state.get("result"):
            raise IllegalAction("The game is over")

        # Clock first: if the mover ran out of time, the move is rejected.
        timeout = self._settle_clock(state)
        if timeout is not None:
            return ApplyResult(
                events=[{"type": "game_over", "seat": None, "payload": timeout}],
                finished=True,
                result=timeout,
            )

        board = chess.Board(state["fen"])

        expected_seat = 0 if board.turn == chess.WHITE else 1
        if seat != expected_seat:
            raise IllegalAction("Not your turn")

        uci = payload.get("move")
        if not isinstance(uci, str):
            raise IllegalAction("Missing 'move' (UCI string)")
        try:
            move = chess.Move.from_uci(uci.strip())
        except ValueError:
            raise IllegalAction(f"Invalid move format: {uci!r}") from None
        if move not in board.legal_moves:
            raise IllegalAction(f"Illegal move: {uci}")

        san = board.san(move)
        board.push(move)
        state["fen"] = board.fen()
        state["san_history"] = [*state.get("san_history", []), san]
        state["turn_started_at"] = time.time()  # new turn for the opponent

        events = [{"type": "move_made", "seat": seat, "payload": {"san": san, "uci": uci}}]

        result = None
        finished = False
        outcome = board.outcome()  # checkmate/stalemate/insufficient/75-move/5-fold
        if outcome is not None:
            finished = True
            result = {"reason": outcome.termination.name.lower()}
            result["winner_seat"] = (
                {chess.WHITE: 0, chess.BLACK: 1}.get(outcome.winner)
                if outcome.winner is not None
                else None
            )
            events.append({"type": "game_over", "seat": None, "payload": result})

        return ApplyResult(events=events, finished=finished, result=result)

    def random_move(self, state: dict) -> ApplyResult:
        """Site plays a random legal move for the side to move (auto-move timer)."""
        timeout = self._settle_clock(state)
        if timeout is not None:
            return ApplyResult(
                events=[{"type": "game_over", "seat": None, "payload": timeout}],
                finished=True,
                result=timeout,
            )
        board = chess.Board(state["fen"])
        seat = self.turn_seat(state)
        move = random.choice(list(board.legal_moves))
        san = board.san(move)
        uci = move.uci()
        board.push(move)
        state["fen"] = board.fen()
        state["san_history"] = [*state.get("san_history", []), san]
        state["turn_started_at"] = time.time()

        events = [{"type": "move_made", "seat": seat, "payload": {"san": san, "uci": uci}}]

        result = None
        finished = False
        outcome = board.outcome()
        if outcome is not None:
            finished = True
            result = {
                "reason": outcome.termination.name.lower(),
                "winner_seat": (
                    {chess.WHITE: 0, chess.BLACK: 1}.get(outcome.winner)
                    if outcome.winner is not None
                    else None
                ),
            }
            events.append({"type": "game_over", "seat": None, "payload": result})
        return ApplyResult(events=events, finished=finished, result=result)

    def visible_state(self, state: dict, seat: int | None) -> dict[str, Any]:
        board = chess.Board(state["fen"])
        turn_seat = 0 if board.turn == chess.WHITE else 1
        out: dict[str, Any] = {
            "fen": state["fen"],
            "san_history": state.get("san_history", []),
            "turn_seat": turn_seat,
            "clocks": state.get("clocks") or {"0": self.CLOCK_SECONDS, "1": self.CLOCK_SECONDS},
            "turn_started_at": state.get("turn_started_at"),
            "paused": state.get("paused"),
        }
        legal: list[str] | None = None
        viewer_seat = seat
        if viewer_seat is not None and viewer_seat == turn_seat and not state.get("result"):
            legal = sorted(m.uci() for m in board.legal_moves)
        elif viewer_seat is not None and board.is_game_over():
            legal = []
        out["legal_moves"] = legal  # None => not this player's turn / spectator

        if board.is_check() and not state.get("result"):
            out["check_square"] = chess.square_name(board.king(board.turn))

        stored = state.get("result")
        if stored is not None:
            out["result"] = stored
        else:
            outcome = board.outcome()
            if outcome is not None:
                winner_seat = (
                    {chess.WHITE: 0, chess.BLACK: 1}.get(outcome.winner)
                    if outcome.winner is not None
                    else None
                )
                out["result"] = {
                    "reason": outcome.termination.name.lower(),
                    "winner_seat": winner_seat,
                }
        return out
