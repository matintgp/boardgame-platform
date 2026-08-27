"""Registry of playable games. New games plug in here."""

from app.games.base import BaseEngine, IllegalAction
from app.games.chess_engine import ChessEngine
from app.games.mafia_engine import MafiaEngine
from app.games.rokugan_engine import RokuganEngine
from app.games.salem_engine import SalemEngine

ENGINES: dict[str, type[BaseEngine]] = {
    ChessEngine.game_id: ChessEngine,
    RokuganEngine.game_id: RokuganEngine,
    MafiaEngine.game_id: MafiaEngine,
    SalemEngine.game_id: SalemEngine,
}


def get_engine(game_id: str) -> type[BaseEngine]:
    engine_cls = ENGINES.get(game_id)
    if engine_cls is None:
        raise KeyError(f"Unknown game type: {game_id}")
    return engine_cls


__all__ = ["BaseEngine", "IllegalAction", "ENGINES", "get_engine"]
