"""Mafia - social deduction game for 4-8 players.

Roles: mafia (kills at night), doctor (saves one player at night), citizens.
Night actions and day votes are SECRET and simultaneous. Dead players watch
but cannot act or vote.

Win conditions:
- All mafia eliminated -> citizens win.
- Alive mafia >= alive citizens -> mafia wins.

Hidden-information contract: visible_state reveals ONLY your own role (plus
teammates if you are mafia), your own secret actions, and public announcements.
"""

import random
from typing import Any, ClassVar

from app.games.base import ApplyResult, BaseEngine, IllegalAction


class MafiaEngine(BaseEngine):
    game_id: ClassVar[str] = "mafia"
    name: ClassVar[str] = "Mafia"
    min_players: ClassVar[int] = 4
    max_players: ClassVar[int] = 8

    def init_state(self, config: dict, seats: list[str]) -> dict:
        n = len(seats)
        mafia_count = 1 if n <= 5 else 2
        pool = ["mafia"] * mafia_count + ["doctor"] + ["citizen"] * (n - mafia_count - 1)
        random.shuffle(pool)
        return {
            "phase": "night",
            "round": 1,
            "roles": {str(i): pool[i] for i in range(n)},
            "alive": {str(i): True for i in range(n)},
            "mafia_target": None,
            "doctor_save": None,
            "votes": {},
            "last_night": None,
            "last_vote": None,
            "log": [],
            "result": None,
        }

    # ---- helpers ------------------------------------------------------------

    def _alive_seats(self, state: dict) -> list[int]:
        return [int(s) for s, alive in state["alive"].items() if alive]

    def _alive_mafia(self, state: dict) -> list[int]:
        return [
            int(s)
            for s, alive in state["alive"].items()
            if alive and state["roles"][s] == "mafia"
        ]

    def _check_win(self, state: dict) -> dict | None:
        alive = self._alive_seats(state)
        mafia = self._alive_mafia(state)
        citizens = [s for s in alive if s not in mafia]
        if not mafia:
            return {
                "reason": "citizens_won",
                "winner_role": "citizens",
                "winner_seats": citizens,
                "winner_seat": None,
            }
        if len(mafia) >= len(citizens):
            return {
                "reason": "mafia_won",
                "winner_role": "mafia",
                "winner_seats": mafia,
                "winner_seat": None,
            }
        return None

    def _finish(self, state: dict, events: list[dict]) -> ApplyResult:
        result = self._check_win(state)
        state["result"] = result
        state["phase"] = "over"
        events.append({"type": "game_over", "seat": None, "payload": result})
        return ApplyResult(events=events, finished=True, result=result)

    def _validate_target(self, state: dict, target: Any) -> int:
        if not isinstance(target, int) or target not in self._alive_seats(state):
            raise IllegalAction("Invalid target")
        return target

    # ---- actions ------------------------------------------------------------

    def apply_action(
        self, state: dict, seat: int, action_type: str, payload: dict
    ) -> ApplyResult:
        if state["phase"] == "over":
            raise IllegalAction("The game is over")
        role = state["roles"][str(seat)]

        if state["phase"] == "night":
            if action_type == "mafia_kill":
                if role != "mafia":
                    raise IllegalAction("Only mafia can kill")
                if not state["alive"][str(seat)]:
                    raise IllegalAction("Dead players cannot act")
                target = self._validate_target(state, payload.get("target"))
                if state["roles"][str(target)] == "mafia":
                    raise IllegalAction("You cannot target a teammate")
                state["mafia_target"] = target
                events = [{"type": "night_action", "seat": seat, "payload": {}}]
                return self._maybe_resolve_night(state, events)

            if action_type == "doctor_save":
                if role != "doctor":
                    raise IllegalAction("Only the doctor can save")
                if not state["alive"][str(seat)]:
                    raise IllegalAction("Dead players cannot act")
                target = self._validate_target(state, payload.get("target"))
                state["doctor_save"] = target
                events = [{"type": "night_action", "seat": seat, "payload": {}}]
                return self._maybe_resolve_night(state, events)

            raise IllegalAction("No night action for you")

        if state["phase"] == "day":
            if action_type != "vote":
                raise IllegalAction("Unknown action")
            if not state["alive"][str(seat)]:
                raise IllegalAction("Dead players cannot vote")
            target = self._validate_target(state, payload.get("target"))
            state["votes"][str(seat)] = target
            events = [{"type": "vote_cast", "seat": seat, "payload": {}}]
            alive_voters = self._alive_seats(state)
            if all(str(v) in state["votes"] for v in alive_voters):
                return self._resolve_day(state, events)
            return ApplyResult(events=events, finished=False)

        raise IllegalAction("Unknown phase")

    def _maybe_resolve_night(self, state: dict, events: list[dict]) -> ApplyResult:
        mafia = self._alive_mafia(state)
        doctor_alive = any(
            state["alive"][str(s)]
            and state["roles"][str(s)] == "doctor"
            for s in self._alive_seats(state)
        )
        mafia_ready = state["mafia_target"] is not None
        doctor_ready = (not doctor_alive) or state["doctor_save"] is not None
        if not (mafia_ready and doctor_ready):
            return ApplyResult(events=events, finished=False)
        return self._resolve_night(state, events)

    def _resolve_night(self, state: dict, events: list[dict]) -> ApplyResult:
        target = state["mafia_target"]
        saved = state["doctor_save"] == target
        killed = None if saved or target is None else target
        if killed is not None:
            state["alive"][str(killed)] = False
        state["last_night"] = {"killed": killed, "saved": saved}
        state["log"].append({"round": state["round"], "phase": "night", **state["last_night"]})
        state["mafia_target"] = None
        state["doctor_save"] = None
        events.append({
            "type": "night_resolved",
            "seat": None,
            "payload": {"killed": killed, "saved": saved},
        })

        if (win := self._check_win(state)) is not None:
            return self._finish(state, events)

        state["phase"] = "day"
        state["votes"] = {}
        return ApplyResult(events=events, finished=False)

    def _resolve_day(self, state: dict, events: list[dict]) -> ApplyResult:
        tally: dict[int, int] = {}
        for target in state["votes"].values():
            tally[target] = tally.get(target, 0) + 1
        top = max(tally.values())
        leaders = [s for s, c in tally.items() if c == top]
        eliminated = leaders[0] if len(leaders) == 1 else None
        if eliminated is not None:
            state["alive"][str(eliminated)] = False
        state["last_vote"] = {"eliminated": eliminated, "tie": len(leaders) > 1, "tally": tally}
        state["log"].append({"round": state["round"], "phase": "day", **state["last_vote"]})
        state["votes"] = {}
        role = state["roles"][str(eliminated)] if eliminated is not None else None
        events.append({
            "type": "vote_resolved",
            "seat": None,
            "payload": {"eliminated": eliminated, "role": role, "tie": len(leaders) > 1},
        })

        if (win := self._check_win(state)) is not None:
            return self._finish(state, events)

        state["phase"] = "night"
        state["round"] += 1
        return ApplyResult(events=events, finished=False)

    # ---- visibility ---------------------------------------------------------

    def visible_state(self, state: dict, seat: int | None) -> dict[str, Any]:
        out: dict[str, Any] = {
            "phase": state["phase"],
            "round": state["round"],
            "alive": state["alive"],
            "last_night": state["last_night"],
            "last_vote": state["last_vote"],
            "log": state["log"],
            "result": state.get("result"),
        }
        if seat is None:
            out["you"] = None
            return out
        role = state["roles"][str(seat)]
        you: dict[str, Any] = {
            "seat": seat,
            "role": role,
            "alive": state["alive"][str(seat)],
        }
        if role == "mafia":
            you["teammates"] = self._alive_mafia(state)
        if state["phase"] == "night":
            if role == "mafia":
                you["my_action"] = state["mafia_target"]
                you["team_ready"] = state["mafia_target"] is not None
            elif role == "doctor":
                you["my_action"] = state["doctor_save"]
        if state["phase"] == "day":
            you["my_vote"] = state["votes"].get(str(seat))
            alive_voters = self._alive_seats(state)
            you["votes_in"] = sum(1 for v in alive_voters if str(v) in state["votes"])
            you["votes_needed"] = len(alive_voters)
        out["you"] = you
        return out
