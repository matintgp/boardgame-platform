"""Mafia - social deduction game for 4-8 players.

Roles: mafia (kills at night), doctor (saves one player at night), citizens.
Night actions and day votes are SECRET and simultaneous. Dead players watch
but cannot act or vote.

Win conditions:
- All mafia eliminated -> citizens win.
- Alive mafia >= alive citizens -> mafia wins.

Night consensus: every living mafia submits `mafia_kill`; night resolves only
when they all pick the SAME living non-mafia target AND the doctor has saved
(if alive). Mismatched targets stay open; a mafia may re-submit to converge.

Hidden-information contract: visible_state reveals ONLY your own role (plus
teammates if you are mafia), your own secret actions, and public announcements.
Public last_night exposes `killed` (who died / nobody died) but never whether
the doctor succeeded. On game over, `result.roles` is the full seat→role map.
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
            "mafia_votes": {},
            "doctor_save": None,
            "votes": {},
            "last_night": None,
            "last_vote": None,
            "log": [],
            "result": None,
        }

    # ---- helpers ------------------------------------------------------------

    def _alive_seats(self, state: dict) -> list[int]:
        return sorted(int(s) for s, alive in state["alive"].items() if alive)

    def _mafia_seats(self, state: dict) -> list[int]:
        return sorted(int(s) for s, role in state["roles"].items() if role == "mafia")

    def _alive_mafia(self, state: dict) -> list[int]:
        return [s for s in self._mafia_seats(state) if state["alive"][str(s)]]

    def _town_seats(self, state: dict) -> list[int]:
        return sorted(int(s) for s, role in state["roles"].items() if role != "mafia")

    def _doctor_alive(self, state: dict) -> bool:
        return any(
            state["alive"][s] and role == "doctor" for s, role in state["roles"].items()
        )

    def _agreed_mafia_target(self, state: dict) -> int | None:
        """Return the shared kill target iff every living mafia has voted for it."""
        mafia = self._alive_mafia(state)
        if not mafia:
            return None
        votes = state["mafia_votes"]
        if not all(str(s) in votes for s in mafia):
            return None
        targets = {votes[str(s)] for s in mafia}
        if len(targets) != 1:
            return None
        return next(iter(targets))

    def _public_last_night(self, last_night: dict | None) -> dict | None:
        if last_night is None:
            return None
        return {"killed": last_night.get("killed")}

    def _check_win(self, state: dict) -> dict | None:
        alive = self._alive_seats(state)
        mafia = self._alive_mafia(state)
        citizens = [s for s in alive if s not in mafia]
        if not mafia:
            return self._result_dict(state, "citizens_won", "citizens", self._town_seats(state))
        if len(mafia) >= len(citizens):
            return self._result_dict(state, "mafia_won", "mafia", self._mafia_seats(state))
        return None

    def _result_dict(
        self, state: dict, reason: str, winner_role: str, winner_seats: list[int]
    ) -> dict:
        return {
            "reason": reason,
            "winner_role": winner_role,
            "winner_seats": winner_seats,
            "winner_seat": None,
            "roles": dict(state["roles"]),
        }

    def _finish(self, state: dict, events: list[dict]) -> ApplyResult:
        result = self._check_win(state)
        state["result"] = result
        state["phase"] = "over"
        events.append({"type": "game_over", "seat": None, "payload": result})
        return ApplyResult(events=events, finished=True, result=result)

    def _validate_target(self, state: dict, target: Any) -> int:
        if not isinstance(target, int) or isinstance(target, bool):
            raise IllegalAction("Invalid target")
        if target not in self._alive_seats(state):
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
                state["mafia_votes"][str(seat)] = target
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
        mafia_target = self._agreed_mafia_target(state)
        doctor_ready = (not self._doctor_alive(state)) or state["doctor_save"] is not None
        if mafia_target is None or not doctor_ready:
            return ApplyResult(events=events, finished=False)
        return self._resolve_night(state, events, mafia_target)

    def _resolve_night(self, state: dict, events: list[dict], target: int) -> ApplyResult:
        saved = state["doctor_save"] == target
        killed = None if saved else target
        if killed is not None:
            state["alive"][str(killed)] = False
        # Public shape: killed only. Save success is not advertised.
        last_night = {"killed": killed}
        state["last_night"] = last_night
        state["log"].append({"round": state["round"], "phase": "night", **last_night})
        state["mafia_votes"] = {}
        state["doctor_save"] = None
        events.append({
            "type": "night_resolved",
            "seat": None,
            "payload": {"killed": killed},
        })

        if self._check_win(state) is not None:
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
        role = state["roles"][str(eliminated)] if eliminated is not None else None
        last_vote = {
            "eliminated": eliminated,
            "tie": len(leaders) > 1,
            "tally": {str(s): c for s, c in tally.items()},
            "role": role,
        }
        state["last_vote"] = last_vote
        state["log"].append({"round": state["round"], "phase": "day", **last_vote})
        state["votes"] = {}
        events.append({
            "type": "vote_resolved",
            "seat": None,
            "payload": {"eliminated": eliminated, "role": role, "tie": len(leaders) > 1},
        })

        if self._check_win(state) is not None:
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
            "last_night": self._public_last_night(state["last_night"]),
            "last_vote": state["last_vote"],
            "log": list(state["log"]),
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
            you["teammates"] = self._mafia_seats(state)
        if state["phase"] == "night":
            if role == "mafia":
                you["my_action"] = state["mafia_votes"].get(str(seat))
                you["team_ready"] = self._agreed_mafia_target(state) is not None
            elif role == "doctor":
                you["my_action"] = state["doctor_save"]
        if state["phase"] == "day":
            you["my_vote"] = state["votes"].get(str(seat))
            alive_voters = self._alive_seats(state)
            you["votes_in"] = sum(1 for v in alive_voters if str(v) in state["votes"])
            you["votes_needed"] = len(alive_voters)
        out["you"] = you
        return out
