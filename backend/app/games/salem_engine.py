"""Salem 1692 engine (2e loop) for 4–12 players.

See salem_data.py for Town Hall mapping and original card ids. Engines are
pure/synchronous: the service layer owns I/O and timers. A `tick` action
auto-skips leftover confessions once `confess_deadline` has passed; the
chess-only timer loop is not wired in.
"""

from __future__ import annotations

import random
import time
from typing import Any, ClassVar

from app.games.base import ApplyResult, BaseEngine, IllegalAction
from app.games.salem_data import (
    ALL_PLAY_CARDS,
    BLUE_CARDS,
    CONFESS_SECONDS,
    GREEN_CARDS,
    HAND_SIZE,
    MARK_THRESHOLD,
    RED_CARDS,
    RED_MARKS,
    TOWN_HALL,
    TOWN_HALL_ORDER,
    TRYAL_CONSTABLE,
    TRYAL_COUNTS,
    TRYAL_INNOCENT,
    TRYAL_WITCH,
    build_deck,
    town_hall_public,
)


def _as_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise IllegalAction(f"Invalid {label}")
    return value


class SalemEngine(BaseEngine):
    game_id: ClassVar[str] = "salem"
    name: ClassVar[str] = "Salem 1692"
    min_players: ClassVar[int] = 4
    max_players: ClassVar[int] = 12

    def validate_config(self, config: dict) -> dict:
        out: dict[str, Any] = {}
        if config and "seed" in config:
            out["seed"] = int(config["seed"])
        return out

    # ---- setup --------------------------------------------------------------

    def init_state(self, config: dict, seats: list[str]) -> dict:
        n = len(seats)
        if n not in TRYAL_COUNTS:
            raise ValueError(f"Salem requires 4-12 players, got {n}")
        rng = random.Random((config or {}).get("seed"))
        innocents, witches, constables = TRYAL_COUNTS[n]
        tryal_pool = (
            [TRYAL_INNOCENT] * innocents
            + [TRYAL_WITCH] * witches
            + [TRYAL_CONSTABLE] * constables
        )
        rng.shuffle(tryal_pool)
        per = len(tryal_pool) // n
        tryals: dict[str, list[dict]] = {}
        for i in range(n):
            chunk = tryal_pool[i * per : (i + 1) * per]
            tryals[str(i)] = [{"id": cid, "revealed": False} for cid in chunk]

        chars = list(TOWN_HALL_ORDER)
        rng.shuffle(chars)
        town_hall = {str(i): town_hall_public(chars[i]) for i in range(n)}

        deck = build_deck(n)
        rng.shuffle(deck)
        hands: dict[str, list[str]] = {str(i): [] for i in range(n)}
        for _ in range(HAND_SIZE):
            for i in range(n):
                hands[str(i)].append(deck.pop())

        marks = {str(i): 0 for i in range(n)}
        witch_seats: list[int] = []
        current_seat = 0
        for i in range(n):
            ability = TOWN_HALL[town_hall[str(i)]["id"]]["ability"]
            if ability == "extra_card" and deck:
                hands[str(i)].append(deck.pop())
            if ability == "extra_accusation":
                hands[str(i)].append("accusation")
            if ability == "start_marks":
                marks[str(i)] = 2
            if ability == "goes_first":
                current_seat = i
            for card in tryals[str(i)]:
                if card["id"] == TRYAL_WITCH and i not in witch_seats:
                    witch_seats.append(i)

        return {
            "phase": "day",
            "round": 1,
            "n": n,
            "alive": {str(i): True for i in range(n)},
            "town_hall": town_hall,
            "marks": marks,
            "tryals": tryals,
            "witches": witch_seats,
            "hands": hands,
            "blues": {str(i): [] for i in range(n)},
            "deck": deck,
            "discard": [],
            "current_seat": current_seat,
            "skip_turns": {},
            "conspiracy_picks": {},
            "night_kills": {},
            "gavel_target": None,
            "gavel_submitted": False,
            "night_victim": None,
            "confessed": {},
            "confess_deadline": None,
            "last_night": None,
            "last_reveal": None,
            "result": None,
        }

    # ---- queries ------------------------------------------------------------

    def _alive_seats(self, state: dict) -> list[int]:
        return sorted(int(s) for s, alive in state["alive"].items() if alive)

    def _ability(self, state: dict, seat: int) -> str:
        th = state["town_hall"][str(seat)]
        cid = th["id"] if isinstance(th, dict) else th
        return TOWN_HALL.get(cid, {}).get("ability", "")

    def _is_witch(self, state: dict, seat: int) -> bool:
        return seat in state["witches"]

    def _alive_witches(self, state: dict) -> list[int]:
        return [s for s in state["witches"] if state["alive"].get(str(s))]

    def _constable_seat(self, state: dict) -> int | None:
        """Holder of the unrevealed Constable tryal (may be dead)."""
        for s, row in state["tryals"].items():
            for card in row:
                if card["id"] == TRYAL_CONSTABLE and not card["revealed"]:
                    return int(s)
        return None

    def _is_constable(self, state: dict, seat: int) -> bool:
        return self._constable_seat(state) == seat

    def _left_seat(self, state: dict, seat: int) -> int:
        return (seat - 1) % state["n"]

    def _has_blue(self, state: dict, seat: int, card_id: str) -> bool:
        return card_id in state["blues"].get(str(seat), [])

    def _unrevealed_indexes(self, state: dict, seat: int) -> list[int]:
        return [
            i
            for i, c in enumerate(state["tryals"][str(seat)])
            if not c["revealed"]
        ]

    def _see_witch(self, state: dict, seat: int, card_id: str) -> None:
        if card_id == TRYAL_WITCH and seat not in state["witches"]:
            state["witches"].append(seat)

    def _require_alive(self, state: dict, seat: int) -> None:
        if not state["alive"].get(str(seat)):
            raise IllegalAction("Dead players cannot act")

    def _require_target(self, state: dict, payload: dict, *, living: bool = True) -> int:
        target = _as_int(payload.get("target"), "target")
        if target < 0 or target >= state["n"]:
            raise IllegalAction("Invalid target")
        if living and not state["alive"].get(str(target)):
            raise IllegalAction("Invalid target")
        return target

    def _extra(self, payload: dict) -> dict:
        extra = payload.get("extra") or {}
        return extra if isinstance(extra, dict) else {}

    # ---- win / finish -------------------------------------------------------

    def _all_witches_revealed(self, state: dict) -> bool:
        found = False
        for row in state["tryals"].values():
            for card in row:
                if card["id"] == TRYAL_WITCH:
                    found = True
                    if not card["revealed"]:
                        return False
        return found

    def _check_win(self, state: dict) -> dict | None:
        alive = self._alive_seats(state)
        witches = set(state["witches"])
        living_town = [s for s in alive if s not in witches]
        if not living_town and alive:
            return self._result_dict(state, "witches_won", "witches", sorted(witches))
        if not living_town and not alive:
            return self._result_dict(state, "witches_won", "witches", sorted(witches))
        if self._all_witches_revealed(state):
            town = [i for i in range(state["n"]) if i not in witches]
            return self._result_dict(state, "town_won", "town", town)
        return None

    def _result_dict(
        self, state: dict, reason: str, winner_role: str, winner_seats: list[int]
    ) -> dict:
        roles = {
            str(i): ("witch" if i in state["witches"] else "town")
            for i in range(state["n"])
        }
        tryals = {
            s: [{"id": c["id"], "revealed": c["revealed"]} for c in row]
            for s, row in state["tryals"].items()
        }
        return {
            "reason": reason,
            "winner_role": winner_role,
            "winner_seats": winner_seats,
            "winner_seat": None,
            "roles": roles,
            "tryals": tryals,
        }

    def _finish(self, state: dict, events: list[dict], result: dict | None = None) -> ApplyResult:
        result = result or self._check_win(state)
        assert result is not None
        state["result"] = result
        state["phase"] = "over"
        events.append({"type": "game_over", "seat": None, "payload": result})
        return ApplyResult(events=events, finished=True, result=result)

    def _maybe_finish(self, state: dict, events: list[dict]) -> ApplyResult | None:
        result = self._check_win(state)
        if result is None:
            return None
        return self._finish(state, events, result)

    # ---- deck / turn --------------------------------------------------------

    def _reshuffle(self, state: dict) -> None:
        discard = list(state["discard"])
        if not discard:
            return
        top = discard[-1]
        rest = discard[:-1]
        random.shuffle(rest)
        state["deck"] = rest
        state["discard"] = [top]

    def _draw(self, state: dict, seat: int, count: int = 1) -> None:
        if not state["alive"].get(str(seat)):
            return
        hand = state["hands"][str(seat)]
        for _ in range(count):
            if not state["deck"]:
                self._reshuffle(state)
            if not state["deck"]:
                return
            hand.append(state["deck"].pop())

    def _discard(self, state: dict, card_id: str) -> None:
        state["discard"].append(card_id)

    def _advance_turn(self, state: dict, from_seat: int) -> None:
        n = state["n"]
        for step in range(1, n + 1):
            cand = (from_seat + step) % n
            if not state["alive"].get(str(cand)):
                continue
            skips = int(state["skip_turns"].get(str(cand), 0) or 0)
            if skips > 0:
                state["skip_turns"][str(cand)] = skips - 1
                continue
            state["current_seat"] = cand
            return
        state["current_seat"] = from_seat

    def _after_day_card(self, state: dict, seat: int, events: list[dict]) -> ApplyResult:
        done = self._maybe_finish(state, events)
        if done is not None:
            return done
        self._draw(state, seat, 1)
        if state["phase"] == "day":
            self._advance_turn(state, seat)
        else:
            # Conspiracy / night: resume day with the next living seat.
            self._advance_turn(state, seat)
        return ApplyResult(events=events, finished=False)

    def _kill(self, state: dict, seat: int) -> None:
        if not state["alive"].get(str(seat)):
            return
        state["alive"][str(seat)] = False
        living = self._alive_seats(state)
        for s in living:
            state["hands"][str(s)].append("accusation")
        if self._ability(state, seat) == "draw_on_death":
            for s in living:
                self._draw(state, s, 1)

    # ---- tryal reveal -------------------------------------------------------

    def _reveal_tryal(
        self, state: dict, seat: int, index: int, events: list[dict]
    ) -> str:
        row = state["tryals"][str(seat)]
        if index < 0 or index >= len(row):
            raise IllegalAction("Invalid tryal index")
        card = row[index]
        if card["revealed"]:
            raise IllegalAction("That tryal is already revealed")
        card["revealed"] = True
        self._see_witch(state, seat, card["id"])
        last = {"seat": seat, "index": index, "id": card["id"]}
        state["last_reveal"] = last
        events.append({"type": "tryal_revealed", "seat": None, "payload": dict(last)})
        for i in range(state["n"]):
            if (
                state["alive"].get(str(i))
                and self._ability(state, i) == "draw_on_reveal"
            ):
                self._draw(state, i, 1)
        return card["id"]

    def _reveal_for_marks(
        self, state: dict, seat: int, tryal_index: Any, events: list[dict]
    ) -> None:
        open_idx = self._unrevealed_indexes(state, seat)
        if not open_idx:
            return
        if tryal_index is None:
            index = open_idx[0]
        else:
            index = _as_int(tryal_index, "tryal_index")
            if index not in open_idx:
                raise IllegalAction("Invalid tryal index")
        self._reveal_tryal(state, seat, index, events)

    # ---- actions ------------------------------------------------------------

    def apply_action(
        self, state: dict, seat: int, action_type: str, payload: dict
    ) -> ApplyResult:
        payload = payload or {}
        if state.get("phase") == "over":
            raise IllegalAction("The game is over")

        if action_type == "tick":
            return self._tick(state)

        if action_type == "play_card":
            return self._play_card(state, seat, payload)
        if action_type == "conspiracy_take":
            return self._conspiracy_take(state, seat, payload)
        if action_type == "night_kill":
            return self._night_kill(state, seat, payload)
        if action_type == "gavel":
            return self._gavel(state, seat, payload)
        if action_type == "confess":
            return self._confess(state, seat, payload)
        if action_type == "confess_skip":
            return self._confess_skip(state, seat)
        if action_type == "choose_town_hall":
            raise IllegalAction(
                "Town Hall characters are assigned automatically in this version"
            )
        raise IllegalAction(f"Unknown action '{action_type}'")

    def resolve_if_ready(self, state: dict, events: list[dict] | None = None) -> ApplyResult:
        """Resolve conspiracy or confess/night when every living player has submitted."""
        events = events if events is not None else []
        phase = state["phase"]
        if phase == "conspiracy":
            alive = self._alive_seats(state)
            if alive and all(str(s) in state["conspiracy_picks"] for s in alive):
                return self._resolve_conspiracy(state, events)
            return ApplyResult(events=events, finished=False)
        if phase == "confess":
            alive = self._alive_seats(state)
            if alive and all(str(s) in state["confessed"] for s in alive):
                return self._resolve_night_kill(state, events)
            return ApplyResult(events=events, finished=False)
        if phase == "night":
            return self._maybe_enter_confess(state, events)
        return ApplyResult(events=events, finished=False)

    def _tick(self, state: dict) -> ApplyResult:
        if state["phase"] != "confess":
            return ApplyResult(events=[], finished=False)
        deadline = state.get("confess_deadline")
        if deadline is not None and time.time() < float(deadline):
            return ApplyResult(events=[], finished=False)
        for s in self._alive_seats(state):
            state["confessed"].setdefault(str(s), "skip")
        return self.resolve_if_ready(state, [])

    def _play_card(self, state: dict, seat: int, payload: dict) -> ApplyResult:
        if state["phase"] != "day":
            raise IllegalAction("You can only play cards during the day")
        self._require_alive(state, seat)
        if seat != state["current_seat"]:
            raise IllegalAction("It is not your turn")
        card_id = payload.get("card_id")
        if not isinstance(card_id, str) or card_id not in ALL_PLAY_CARDS:
            raise IllegalAction("Unknown card")
        hand = state["hands"][str(seat)]
        if card_id not in hand:
            raise IllegalAction("You do not have that card")
        extra = self._extra(payload)

        needs_target = card_id in RED_CARDS or card_id in GREEN_CARDS or card_id in BLUE_CARDS
        target: int | None = None
        if needs_target:
            if payload.get("target") is None:
                raise IllegalAction("That card needs a target")
            target = self._require_target(state, payload)

        if card_id in RED_CARDS and target is not None:
            self._validate_red(state, seat, card_id, target, extra)
        if card_id in GREEN_CARDS and target is not None:
            self._validate_green(state, seat, card_id, target, extra)

        hand.remove(card_id)
        events = [
            {
                "type": "card_played",
                "seat": seat,
                "payload": {"card_id": card_id, "target": target},
            }
        ]

        if card_id in RED_CARDS:
            assert target is not None
            add = RED_MARKS[card_id]
            if self._ability(state, seat) == "red_plus_one":
                add += 1
            key = str(target)
            state["marks"][key] = int(state["marks"].get(key, 0)) + add
            if state["marks"][key] >= MARK_THRESHOLD:
                self._reveal_for_marks(state, target, extra.get("tryal_index"), events)
                state["marks"][key] = 0
            self._discard(state, card_id)
            return self._after_day_card(state, seat, events)

        if card_id in GREEN_CARDS:
            assert target is not None
            self._apply_green(state, seat, card_id, target, extra, events)
            self._discard(state, card_id)
            if self._ability(state, seat) == "alibi_draw" and card_id == "alibi":
                self._draw(state, seat, 1)
            return self._after_day_card(state, seat, events)

        if card_id in BLUE_CARDS:
            assert target is not None
            state["blues"][str(target)].append(card_id)
            return self._after_day_card(state, seat, events)

        # Black cards
        self._discard(state, card_id)
        if card_id == "conspiracy":
            self._start_conspiracy(state, seat, extra, events)
            return self._after_day_card(state, seat, events)
        if card_id == "night":
            self._start_night(state)
            return self._after_day_card(state, seat, events)
        raise IllegalAction("Unknown card")

    def _validate_red(
        self, state: dict, seat: int, card_id: str, target: int, extra: dict
    ) -> None:
        add = RED_MARKS[card_id]
        if self._ability(state, seat) == "red_plus_one":
            add += 1
        new_marks = int(state["marks"].get(str(target), 0)) + add
        if new_marks < MARK_THRESHOLD:
            return
        open_idx = self._unrevealed_indexes(state, target)
        if not open_idx:
            return
        if extra.get("tryal_index") is None:
            return
        index = _as_int(extra.get("tryal_index"), "tryal_index")
        if index not in open_idx:
            raise IllegalAction("Invalid tryal index")

    def _validate_green(
        self, state: dict, seat: int, card_id: str, target: int, extra: dict
    ) -> None:
        if card_id == "alibi":
            return
        if card_id == "arson":
            if self._ability(state, target) == "immune_arson":
                raise IllegalAction("That player's permanents cannot be burned")
            if "black_cat" not in state["blues"][str(target)]:
                raise IllegalAction("That player has no permanent cards to burn")
            return
        if card_id == "robbery":
            if target == seat:
                raise IllegalAction("You cannot rob yourself")
            if self._ability(state, target) == "immune_robbery":
                raise IllegalAction("That player's hand cannot be robbed")
            if not state["hands"][str(target)]:
                raise IllegalAction("That player has no cards to steal")
            return
        if card_id == "scapegoat":
            from_raw = extra.get("from_seat", seat)
            from_seat = _as_int(from_raw, "from_seat")
            if from_seat < 0 or from_seat >= state["n"]:
                raise IllegalAction("Invalid from_seat")
            return
        if card_id == "stocks":
            if target == seat:
                raise IllegalAction("You cannot put yourself in the stocks")
            if self._ability(state, target) == "immune_stocks":
                raise IllegalAction("That player cannot be put in the stocks")
            return
        if card_id == "curse":
            if self._ability(state, target) == "immune_curse":
                raise IllegalAction("That player is warded against curses")
            return

    def _apply_green(
        self, state: dict, seat: int, card_id: str, target: int, extra: dict, events: list[dict]
    ) -> None:
        if card_id == "alibi":
            state["marks"][str(target)] = 0
            return
        if card_id == "arson":
            blues = state["blues"][str(target)]
            blues.remove("black_cat")
            self._discard(state, "black_cat")
            return
        if card_id == "robbery":
            other = state["hands"][str(target)]
            stolen = other.pop(random.randrange(len(other)))
            state["hands"][str(seat)].append(stolen)
            return
        if card_id == "scapegoat":
            from_seat = _as_int(extra.get("from_seat", seat), "from_seat")
            moved = int(state["marks"].get(str(from_seat), 0))
            state["marks"][str(from_seat)] = 0
            state["marks"][str(target)] = int(state["marks"].get(str(target), 0)) + moved
            if state["marks"][str(target)] >= MARK_THRESHOLD:
                self._reveal_for_marks(state, target, extra.get("tryal_index"), events)
                state["marks"][str(target)] = 0
            return
        if card_id == "stocks":
            state["skip_turns"][str(target)] = int(
                state["skip_turns"].get(str(target), 0) or 0
            ) + 1
            return
        if card_id == "curse":
            other = state["hands"][str(target)]
            if other:
                dumped = other.pop(random.randrange(len(other)))
                self._discard(state, dumped)
            return
        raise IllegalAction("Unknown card")

    # ---- conspiracy ---------------------------------------------------------

    def _start_conspiracy(
        self, state: dict, _drawer: int, extra: dict, events: list[dict]
    ) -> None:
        # Black cat: drawer reveals one tryal of each living holder (unless sealed).
        for s in self._alive_seats(state):
            if not self._has_blue(state, s, "black_cat"):
                continue
            if self._ability(state, s) == "sealed_tryals":
                continue
            open_idx = self._unrevealed_indexes(state, s)
            if not open_idx:
                continue
            idx = extra.get("tryal_index") if s == extra.get("target") else None
            if idx is None:
                index = open_idx[0]
            else:
                index = _as_int(idx, "tryal_index")
                if index not in open_idx:
                    index = open_idx[0]
            self._reveal_tryal(state, s, index, events)
        state["phase"] = "conspiracy"
        state["conspiracy_picks"] = {}

    def _conspiracy_take(self, state: dict, seat: int, payload: dict) -> ApplyResult:
        if state["phase"] != "conspiracy":
            raise IllegalAction("Conspiracy is not in progress")
        self._require_alive(state, seat)
        index = _as_int(payload.get("tryal_index"), "tryal_index")
        source = self._left_seat(state, seat)
        row = state["tryals"][str(source)]
        if index < 0 or index >= len(row) or row[index]["revealed"]:
            raise IllegalAction("Invalid tryal index")
        state["conspiracy_picks"][str(seat)] = index
        events = [{"type": "conspiracy_take", "seat": seat, "payload": {}}]
        return self.resolve_if_ready(state, events)

    def _resolve_conspiracy(self, state: dict, events: list[dict]) -> ApplyResult:
        alive = self._alive_seats(state)
        # Snapshot then transfer simultaneously (each living player is a unique source).
        taken: dict[int, dict] = {}
        for s in alive:
            source = self._left_seat(state, s)
            index = int(state["conspiracy_picks"][str(s)])
            row = state["tryals"][str(source)]
            taken[s] = row[index]
        # Remove from high index to low per source so remaining indexes stay valid
        # within a single source (unique sources, so one remove each).
        by_source: dict[int, list[tuple[int, int]]] = {}
        for s in alive:
            source = self._left_seat(state, s)
            by_source.setdefault(source, []).append((int(state["conspiracy_picks"][str(s)]), s))
        for source, pairs in by_source.items():
            for index, _taker in sorted(pairs, key=lambda p: p[0], reverse=True):
                state["tryals"][str(source)].pop(index)
        for s in alive:
            card = taken[s]
            state["tryals"][str(s)].append(card)
            self._see_witch(state, s, card["id"])
        state["conspiracy_picks"] = {}
        state["phase"] = "day"
        events.append({"type": "conspiracy_resolved", "seat": None, "payload": {}})
        done = self._maybe_finish(state, events)
        if done is not None:
            return done
        return ApplyResult(events=events, finished=False)

    # ---- night / confess ----------------------------------------------------

    def _start_night(self, state: dict) -> None:
        state["phase"] = "night"
        state["night_kills"] = {}
        state["gavel_target"] = None
        state["gavel_submitted"] = False
        state["night_victim"] = None
        state["confessed"] = {}
        state["confess_deadline"] = None

    def _agreed_witch_target(self, state: dict) -> tuple[bool, int | None]:
        witches = self._alive_witches(state)
        if not witches:
            return True, None
        votes = state["night_kills"]
        if not all(str(s) in votes for s in witches):
            return False, None
        targets = {votes[str(s)] for s in witches}
        if len(targets) != 1:
            return False, None
        return True, next(iter(targets))

    def _gavel_ready(self, state: dict) -> bool:
        c = self._constable_seat(state)
        if c is None:
            return True
        if not state["alive"].get(str(c)):
            return True
        return bool(state.get("gavel_submitted"))

    def _maybe_enter_confess(self, state: dict, events: list[dict]) -> ApplyResult:
        agreed, victim = self._agreed_witch_target(state)
        if not agreed or not self._gavel_ready(state):
            return ApplyResult(events=events, finished=False)
        state["night_victim"] = victim
        state["phase"] = "confess"
        state["confessed"] = {}
        state["confess_deadline"] = time.time() + CONFESS_SECONDS
        return ApplyResult(events=events, finished=False)

    def _night_kill(self, state: dict, seat: int, payload: dict) -> ApplyResult:
        if state["phase"] != "night":
            raise IllegalAction("Night has not fallen")
        self._require_alive(state, seat)
        if not self._is_witch(state, seat):
            raise IllegalAction("Only witches can choose a night target")
        target = self._require_target(state, payload)
        state["night_kills"][str(seat)] = target
        events = [{"type": "night_kill", "seat": seat, "payload": {}}]
        return self._maybe_enter_confess(state, events)

    def _gavel(self, state: dict, seat: int, payload: dict) -> ApplyResult:
        if state["phase"] != "night":
            raise IllegalAction("Night has not fallen")
        self._require_alive(state, seat)
        if not self._is_constable(state, seat):
            raise IllegalAction("Only the Constable can use the gavel")
        target = self._require_target(state, payload)
        state["gavel_target"] = target
        state["gavel_submitted"] = True
        events = [{"type": "gavel", "seat": seat, "payload": {}}]
        return self._maybe_enter_confess(state, events)

    def _confess(self, state: dict, seat: int, payload: dict) -> ApplyResult:
        if state["phase"] != "confess":
            raise IllegalAction("It is not time to confess")
        self._require_alive(state, seat)
        index = _as_int(payload.get("tryal_index"), "tryal_index")
        row = state["tryals"][str(seat)]
        if index < 0 or index >= len(row) or row[index]["revealed"]:
            raise IllegalAction("Invalid tryal index")
        state["confessed"][str(seat)] = index
        events: list[dict] = []
        return self.resolve_if_ready(state, events)

    def _confess_skip(self, state: dict, seat: int) -> ApplyResult:
        if state["phase"] != "confess":
            raise IllegalAction("It is not time to confess")
        self._require_alive(state, seat)
        state["confessed"][str(seat)] = "skip"
        return self.resolve_if_ready(state, [])

    def _resolve_night_kill(self, state: dict, events: list[dict]) -> ApplyResult:
        # Confessions first (may reveal the last Witch tryal → town win).
        for s in self._alive_seats(state):
            choice = state["confessed"].get(str(s), "skip")
            if choice == "skip" or choice is None:
                continue
            index = int(choice)
            row = state["tryals"][str(s)]
            if 0 <= index < len(row) and not row[index]["revealed"]:
                self._reveal_tryal(state, s, index, events)
        done = self._maybe_finish(state, events)
        if done is not None:
            return done

        victim = state.get("night_victim")
        gavel_target = state.get("gavel_target")
        killed: int | None = None
        if isinstance(victim, int) and not isinstance(victim, bool):
            saved = gavel_target == victim
            immune = self._ability(state, victim) == "night_immune"
            if not saved and not immune and state["alive"].get(str(victim)):
                killed = victim
                self._kill(state, victim)

        last_night = {"killed": killed}
        state["last_night"] = last_night
        events.append(
            {"type": "night_resolved", "seat": None, "payload": {"killed": killed}}
        )
        state["night_kills"] = {}
        state["gavel_target"] = None
        state["gavel_submitted"] = False
        state["night_victim"] = None
        state["confessed"] = {}
        state["confess_deadline"] = None

        done = self._maybe_finish(state, events)
        if done is not None:
            return done

        state["phase"] = "day"
        state["round"] = int(state.get("round", 1)) + 1
        return ApplyResult(events=events, finished=False)

    # ---- visibility ---------------------------------------------------------

    def _public_tryals(self, state: dict) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for s, row in state["tryals"].items():
            out[s] = {
                "revealed": [c["id"] for c in row if c["revealed"]],
                "facedown": sum(1 for c in row if not c["revealed"]),
                # Slot indexes still face-down (no card ids). Survives mid-row
                # reveals and Conspiracy left-shifts so clients do not assume
                # a prefix of 0..facedown-1.
                "unrevealed": [i for i, c in enumerate(row) if not c["revealed"]],
            }
        return out

    def visible_state(self, state: dict, seat: int | None) -> dict[str, Any]:
        last_night = state.get("last_night")
        public_night = None
        if last_night is not None:
            public_night = {"killed": last_night.get("killed")}
        out: dict[str, Any] = {
            "phase": state["phase"],
            "round": state["round"],
            "alive": state["alive"],
            "town_hall": state["town_hall"],
            "marks": state["marks"],
            "tryals": self._public_tryals(state),
            "blues": state["blues"],
            "deck_left": len(state.get("deck") or []),
            "discard_top": (state["discard"][-1] if state.get("discard") else None),
            "last_night": public_night,
            "last_reveal": state.get("last_reveal"),
            "confess_deadline": state.get("confess_deadline"),
            "result": state.get("result"),
            "current_seat": state.get("current_seat"),
        }
        if seat is None:
            out["you"] = None
            return out

        alive = bool(state["alive"].get(str(seat)))
        is_witch = self._is_witch(state, seat)
        you: dict[str, Any] = {
            "seat": seat,
            "hand": list(state["hands"].get(str(seat), [])),
            "tryals": [
                {"id": c["id"], "revealed": c["revealed"]}
                for c in state["tryals"].get(str(seat), [])
            ],
            "is_witch": is_witch,
            "is_constable": self._is_constable(state, seat),
            "alive": alive,
        }
        if is_witch:
            you["teammates"] = self._alive_witches(state)
        if alive:
            you["my_conspiracy_pick"] = state.get("conspiracy_picks", {}).get(str(seat))
            if state["phase"] == "night":
                you["my_night_kill"] = state.get("night_kills", {}).get(str(seat))
                you["my_gavel"] = (
                    state.get("gavel_target")
                    if self._is_constable(state, seat) and state.get("gavel_submitted")
                    else None
                )
            else:
                you["my_night_kill"] = None
                you["my_gavel"] = None
        out["you"] = you
        return out
