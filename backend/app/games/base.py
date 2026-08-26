"""Game engine plugin interface.

Every playable game implements this contract. The platform (lobby, realtime,
persistence) is engine-agnostic: adding a new game means adding one module and
registering it. Engines must be pure/synchronous - all I/O happens in the
service layer.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar


class IllegalAction(Exception):
    """Raised when an action violates game rules or turn order."""


@dataclass
class ApplyResult:
    """Outcome of applying a legal action."""

    events: list[dict] = field(default_factory=list)
    finished: bool = False
    result: dict | None = None


class BaseEngine(ABC):
    game_id: ClassVar[str]
    name: ClassVar[str]
    min_players: ClassVar[int]
    max_players: ClassVar[int]

    @abstractmethod
    def init_state(self, config: dict, seats: list[str]) -> dict:
        """Build initial private state. `seats` are user ids ordered by seat."""

    @abstractmethod
    def apply_action(
        self, state: dict, seat: int, action_type: str, payload: dict
    ) -> ApplyResult:
        """Validate + apply an action for the given seat. Mutates and returns state."""

    @abstractmethod
    def visible_state(self, state: dict, seat: int | None) -> dict:
        """The projection of state a client may see. Hidden-info games MUST filter
        by seat here (seat=None => spectator view)."""

    def validate_config(self, config: dict) -> dict:
        return {}
