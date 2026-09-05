"""Chess vs Bot personas, skill mapping, and public profile helpers.

Skill Level / UCI options stay server-side. Clients only see persona metadata.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Literal

PlayerColor = Literal["white", "black", "random"]
ResolvedColor = Literal["white", "black"]


@dataclass(frozen=True, slots=True)
class BotProfile:
    persona_id: str
    difficulty: str
    display_name: str
    tier: int
    skill_level: int
    think_ms: tuple[int, int]  # inclusive delay range after/around compute

    @property
    def avatar_path(self) -> str:
        return f"/chess/bots/{self.persona_id}.svg"

    def public(self) -> dict[str, Any]:
        return {
            "persona_id": self.persona_id,
            "difficulty": self.difficulty,
            "display_name": self.display_name,
            "avatar_path": self.avatar_path,
            "tier": self.tier,
        }


# Ascending strength: Pawn → … → King (UX §4–§5). Skill Levels from Phase B brief.
BOT_PROFILES: dict[str, BotProfile] = {
    "pawn": BotProfile("pawn", "novice", "Pawn Bot", 1, 0, (400, 900)),
    "knight": BotProfile("knight", "easy", "Knight Bot", 2, 3, (500, 1100)),
    "bishop": BotProfile("bishop", "normal", "Bishop Bot", 3, 7, (600, 1300)),
    "rook": BotProfile("rook", "hard", "Rook Bot", 4, 11, (700, 1500)),
    "queen": BotProfile("queen", "expert", "Queen Bot", 5, 16, (900, 1800)),
    "king": BotProfile("king", "master", "King Bot", 6, 20, (1000, 2000)),
}

_DIFFICULTY_ALIASES: dict[str, str] = {
    **{p.persona_id: p.persona_id for p in BOT_PROFILES.values()},
    **{p.difficulty: p.persona_id for p in BOT_PROFILES.values()},
}


class BotConfigError(ValueError):
    """Invalid client bot configuration (maps to HTTP 400)."""

    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


def resolve_persona(difficulty: str) -> BotProfile:
    key = (difficulty or "").strip().lower()
    persona_id = _DIFFICULTY_ALIASES.get(key)
    if persona_id is None:
        raise BotConfigError("unknown_difficulty", f"Unknown difficulty: {difficulty!r}")
    return BOT_PROFILES[persona_id]


def parse_player_color(value: str | None) -> PlayerColor:
    color = (value or "random").strip().lower()
    if color not in ("white", "black", "random"):
        raise BotConfigError("invalid_player_color", f"Invalid player_color: {value!r}")
    return color  # type: ignore[return-value]


def resolve_color(preference: PlayerColor) -> ResolvedColor:
    if preference == "random":
        return random.choice(("white", "black"))
    return preference


def thinking_delay_seconds(profile: BotProfile) -> float:
    lo, hi = profile.think_ms
    return random.randint(lo, hi) / 1000.0


def is_bot_game(settings: dict | None) -> bool:
    if not settings:
        return False
    return settings.get("opponent_type") == "bot" or settings.get("mode") == "bot"


def bot_seat_from_settings(settings: dict) -> int:
    return int(settings["bot_seat"])


def human_seat_from_settings(settings: dict) -> int:
    return int(settings["human_seat"])


def build_bot_settings(
    profile: BotProfile,
    color_preference: PlayerColor,
    resolved: ResolvedColor,
) -> dict[str, Any]:
    human_seat = 0 if resolved == "white" else 1
    bot_seat = 1 - human_seat
    return {
        "mode": "bot",
        "opponent_type": "bot",
        "rated": False,
        "difficulty": profile.persona_id,
        "color_preference": color_preference,
        "player_color": resolved,
        "human_seat": human_seat,
        "bot_seat": bot_seat,
        "bot": {
            "persona_id": profile.persona_id,
            "difficulty": profile.difficulty,
            "display_name": profile.display_name,
            "avatar_path": profile.avatar_path,
            "tier": profile.tier,
            "skill_level": profile.skill_level,
        },
    }


def public_bot_from_settings(settings: dict | None) -> dict[str, Any] | None:
    if not is_bot_game(settings):
        return None
    bot = (settings or {}).get("bot") or {}
    persona_id = bot.get("persona_id") or (settings or {}).get("difficulty")
    try:
        profile = resolve_persona(str(persona_id))
    except BotConfigError:
        return {
            "persona_id": persona_id,
            "difficulty": bot.get("difficulty"),
            "display_name": bot.get("display_name") or "Bot",
            "avatar_path": bot.get("avatar_path") or "/chess/bots/pawn.svg",
            "tier": bot.get("tier") or 1,
        }
    # Prefer stored public fields but never leak skill_level.
    return profile.public()
