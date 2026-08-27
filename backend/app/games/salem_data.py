"""Salem 1692 card tables and Town Hall characters.

IP: original ids/names owned by this site. No Facade Games trademarks, unique
card titles, or flavor text. Historical year in the display name is not IP.

Town Hall mapping (public role archetypes → original characters)
================================================================
Widely described mechanical archetypes (reviews / public rules talk, NOT
unique copyrighted card titles) inspired the abilities below. Names and ids
are original.

  extra-accusation / marks hit harder  → stern_accuser   (Stern Accuser)
  night-kill immunity                  → iron_will       (Iron Will)
  sealed / unpeekable tryals           → sealed_row      (Sealed Row)
  extra starting hand card             → card_cache      (Card Cache)
  extra starting accusation            → crowd_voice     (Crowd Voice)
  immune to stocks                     → steady_hand     (Steady Hand)
  immune to robbery                    → closed_purse    (Closed Purse)
  immune to curse                      → hex_ward        (Hex Ward)
  first player                         → first_light     (First Light)
  on death, others draw                → last_word       (Last Word)
  draw when a tryal is revealed        → town_crier      (Town Crier)
  starts under suspicion (marks)       → marked_stranger (Marked Stranger)
  alibi also draws                     → village_healer  (Village Healer)
  night peek is skipped for v1         → watch_ally      (Watch Ally)
  hex (blue) cannot be burned          → kiln_guard      (Kiln Guard)
  conspiracy peek-proof already sealed → quiet_bench     (Quiet Bench)

Watch Ally: if you hold the Constable tryal, you may gavel even after it would
normally be skipped when you are the night target (no extra action type).
Kiln Guard: arson cannot remove your blues.
Quiet Bench: same sealed-row protection (redundant with Sealed Row so the
12-player deal always has enough distinct seats).
"""

from __future__ import annotations

from typing import Any

# n → (tryal_innocent, tryal_witch, tryal_constable)
TRYAL_COUNTS: dict[int, tuple[int, int, int]] = {
    4: (18, 1, 1),
    5: (23, 1, 1),
    6: (27, 2, 1),
    7: (32, 2, 1),
    8: (29, 2, 1),
    9: (33, 2, 1),
    10: (27, 2, 1),
    11: (30, 2, 1),
    12: (33, 2, 1),
}

TRYAL_INNOCENT = "tryal_innocent"
TRYAL_WITCH = "tryal_witch"
TRYAL_CONSTABLE = "tryal_constable"

RED_MARKS: dict[str, int] = {
    "accusation": 1,
    "evidence": 2,
    "witness": 3,
}

GREEN_CARDS = frozenset({"alibi", "arson", "robbery", "scapegoat", "stocks", "curse"})
BLUE_CARDS = frozenset({"black_cat"})
BLACK_CARDS = frozenset({"conspiracy", "night"})
RED_CARDS = frozenset(RED_MARKS)

ALL_PLAY_CARDS = RED_CARDS | GREEN_CARDS | BLUE_CARDS | BLACK_CARDS

MARK_THRESHOLD = 7
HAND_SIZE = 3
CONFESS_SECONDS = 20

TOWN_HALL: dict[str, dict[str, str]] = {
    "stern_accuser": {"name": "Stern Accuser", "ability": "red_plus_one"},
    "iron_will": {"name": "Iron Will", "ability": "night_immune"},
    "sealed_row": {"name": "Sealed Row", "ability": "sealed_tryals"},
    "card_cache": {"name": "Card Cache", "ability": "extra_card"},
    "crowd_voice": {"name": "Crowd Voice", "ability": "extra_accusation"},
    "steady_hand": {"name": "Steady Hand", "ability": "immune_stocks"},
    "closed_purse": {"name": "Closed Purse", "ability": "immune_robbery"},
    "hex_ward": {"name": "Hex Ward", "ability": "immune_curse"},
    "first_light": {"name": "First Light", "ability": "goes_first"},
    "last_word": {"name": "Last Word", "ability": "draw_on_death"},
    "town_crier": {"name": "Town Crier", "ability": "draw_on_reveal"},
    "marked_stranger": {"name": "Marked Stranger", "ability": "start_marks"},
    "village_healer": {"name": "Village Healer", "ability": "alibi_draw"},
    "watch_ally": {"name": "Watch Ally", "ability": "constable_aid"},
    "kiln_guard": {"name": "Kiln Guard", "ability": "immune_arson"},
    "quiet_bench": {"name": "Quiet Bench", "ability": "sealed_tryals"},
}

TOWN_HALL_ORDER: tuple[str, ...] = tuple(TOWN_HALL.keys())


def build_deck(n: int) -> list[str]:
    """Shared day deck, scaled loosely with table size."""
    cards: list[str] = []
    cards.extend(["accusation"] * (n * 4))
    cards.extend(["evidence"] * n)
    cards.extend(["witness"] * max(2, n // 2))
    cards.extend(["alibi"] * max(4, n))
    cards.extend(["arson"] * 3)
    cards.extend(["robbery"] * 3)
    cards.extend(["scapegoat"] * 3)
    cards.extend(["stocks"] * 3)
    cards.extend(["curse"] * 3)
    cards.extend(["black_cat"] * 4)
    cards.extend(["conspiracy"] * 4)
    cards.extend(["night"] * 5)
    return cards


def town_hall_public(char_id: str) -> dict[str, Any]:
    meta = TOWN_HALL[char_id]
    return {"id": char_id, "name": meta["name"]}
