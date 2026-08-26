"""Rokugan Duel - a 2-player hidden-information strategy game.

Each round BOTH players secretly plan an attack (enemy province + strength
token 1-5) and a defense (own province + strength token). Plans are hidden
until both are locked; then battles resolve simultaneously.

- Attack strength > defense strength (or undefended) => province razed.
- Raze 2 of the opponent's 3 provinces to win; after 5 rounds, whoever has
  fewer razed provinces wins (equal => draw).

The engine keeps secret plans in `state["secret"]`; `visible_state` MUST
filter them per seat - this is the hidden-information contract.
"""

from typing import Any, ClassVar

from app.games.base import ApplyResult, BaseEngine, IllegalAction

TOKENS = (1, 2, 3, 4, 5)


class RokuganEngine(BaseEngine):
    game_id: ClassVar[str] = "rokugan"
    name: ClassVar[str] = "Rokugan Duel"
    min_players: ClassVar[int] = 2
    max_players: ClassVar[int] = 2

    PROVINCES: ClassVar[int] = 3
    MAX_ROUNDS: ClassVar[int] = 5
    RAZES_TO_WIN: ClassVar[int] = 2

    def init_state(self, config: dict, seats: list[str]) -> dict:
        return {
            "round": 1,
            "phase": "choose",  # choose -> (auto resolve) -> choose ... -> over
            "provinces": {"0": [False] * self.PROVINCES, "1": [False] * self.PROVINCES},
            "secret": {"0": None, "1": None},
            "log": [],
            "result": None,
        }

    # ---- validation helpers -------------------------------------------------

    def _validate_plan(self, state: dict, seat: int, payload: dict) -> dict:
        attack = payload.get("attack") or {}
        defense = payload.get("defense") or {}
        opp = str(1 - seat)

        a_target, a_token = attack.get("target"), attack.get("token")
        d_target, d_token = defense.get("target"), defense.get("token")
        for label, v in (("attack.target", a_target), ("defense.target", d_target)):
            if not isinstance(v, int) or not 0 <= v < self.PROVINCES:
                raise IllegalAction(f"Invalid {label}")
        for label, v in (("attack.token", a_token), ("defense.token", d_token)):
            if not isinstance(v, int) or v not in TOKENS:
                raise IllegalAction(f"Invalid {label}")
        if a_token == d_token:
            raise IllegalAction("You cannot use the same token twice in one round")
        if state["provinces"][opp][a_target]:
            raise IllegalAction("That province is already razed")
        if state["provinces"][str(seat)][d_target]:
            raise IllegalAction("You cannot defend a razed province")
        return {
            "attack": {"target": a_target, "token": a_token},
            "defense": {"target": d_target, "token": d_token},
        }

    # ---- core ---------------------------------------------------------------

    def apply_action(
        self, state: dict, seat: int, action_type: str, payload: dict
    ) -> ApplyResult:
        if state["phase"] != "choose":
            raise IllegalAction("This round is already resolved")
        if action_type != "plan":
            raise IllegalAction(f"Unknown action '{action_type}' for rokugan")

        state["secret"][str(seat)] = self._validate_plan(state, seat, payload)
        events: list[dict] = [{"type": "plan_submitted", "seat": seat, "payload": {}}]

        result = None
        finished = False
        if state["secret"][str(1 - seat)] is not None:
            reveal_events, result = self._resolve(state)
            events.extend(reveal_events)
            finished = result is not None
        return ApplyResult(events=events, finished=finished, result=result)

    def _resolve(self, state: dict) -> tuple[list[dict], dict | None]:
        plans = {s: state["secret"][s] for s in ("0", "1")}
        outcomes = []
        for atk_seat in (0, 1):
            def_seat = 1 - atk_seat
            atk_plan = plans[str(atk_seat)]["attack"]
            def_plan = plans[str(def_seat)]["defense"]
            target = atk_plan["target"]
            defended_here = def_plan["target"] == target
            defense = def_plan["token"] if defended_here else 0
            razed = atk_plan["token"] > defense
            if razed:
                state["provinces"][str(def_seat)][target] = True
            outcomes.append({
                "attacker": atk_seat,
                "target": target,
                "attack": atk_plan["token"],
                "defended": defended_here,
                "defense": defense if defended_here else None,
                "razed": razed,
            })

        state["log"].append({"round": state["round"], "outcomes": outcomes})
        state["secret"] = {"0": None, "1": None}

        razed_count = {
            s: sum(state["provinces"][s]) for s in ("0", "1")
        }
        events = [{
            "type": "reveal",
            "seat": None,
            "payload": {"round": state["round"], "outcomes": outcomes},
        }]

        result = None
        decided = razed_count["0"] >= self.RAZES_TO_WIN or razed_count["1"] >= self.RAZES_TO_WIN
        last_round = state["round"] >= self.MAX_ROUNDS
        if decided or last_round:
            if razed_count["0"] < razed_count["1"]:
                winner = 0
            elif razed_count["1"] < razed_count["0"]:
                winner = 1
            else:
                winner = None
            result = {
                "reason": "conquest" if decided else "rounds_complete",
                "winner_seat": winner,
                "razed": razed_count,
            }
            state["result"] = result
            state["phase"] = "over"
            events.append({"type": "game_over", "seat": None, "payload": result})
        else:
            state["round"] += 1
        return events, result

    # apply_action needs the result for the service layer; _resolve returns it.
    def visible_state(self, state: dict, seat: int | None) -> dict[str, Any]:
        out: dict[str, Any] = {
            "round": state["round"],
            "phase": state["phase"],
            "provinces": state["provinces"],
            "log": state["log"],
            "result": state.get("result"),
        }
        if seat is None:
            out["you"] = None
            out["opponent"] = None
            return out
        opp = str(1 - seat)
        out["you"] = {"seat": seat, "plan": state["secret"].get(str(seat))}
        out["opponent"] = {"submitted": state["secret"][opp] is not None}
        return out
