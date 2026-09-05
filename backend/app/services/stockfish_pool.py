"""Reusable Stockfish UCI engine pool (no spawn-per-move).

Supports a FakeUciEngine adapter for unit tests when STOCKFISH_PATH is unset
or the binary is missing.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Protocol

import chess
import chess.engine

from app.core.config import settings

logger = logging.getLogger(__name__)


class EngineFailure(RuntimeError):
    """Stockfish / UCI failure — callers must NOT fall back to a random move."""


class UciEngine(Protocol):
    def configure(self, options: dict) -> None: ...

    def play(
        self, board: chess.Board, limit: chess.engine.Limit, **kwargs
    ) -> chess.engine.PlayResult: ...

    def quit(self) -> None: ...


@dataclass
class _Pooled:
    engine: UciEngine
    lock: threading.Lock
    healthy: bool = True


class FakeUciEngine:
    """Deterministic weak 'engine' for unit tests (first legal move)."""

    def __init__(self) -> None:
        self.options: dict = {}
        self.closed = False

    def configure(self, options: dict) -> None:
        self.options.update(options)

    def play(self, board: chess.Board, limit: chess.engine.Limit, **kwargs) -> chess.engine.PlayResult:
        if self.closed:
            raise EngineFailure("Fake engine closed")
        moves = list(board.legal_moves)
        if not moves:
            raise EngineFailure("No legal moves")
        move = sorted(moves, key=lambda m: m.uci())[0]
        return chess.engine.PlayResult(move=move, ponder=None)

    def quit(self) -> None:
        self.closed = True


class StockfishPool:
    def __init__(
        self,
        path: str | None = None,
        pool_size: int | None = None,
        threads: int | None = None,
        hash_mb: int | None = None,
        move_timeout: float | None = None,
        *,
        fake: bool = False,
    ) -> None:
        self.path = path if path is not None else settings.stockfish_path
        self.pool_size = pool_size if pool_size is not None else settings.chess_bot_pool_size
        self.threads = threads if threads is not None else settings.chess_bot_threads
        self.hash_mb = hash_mb if hash_mb is not None else settings.chess_bot_hash_mb
        self.move_timeout = (
            move_timeout if move_timeout is not None else settings.chess_bot_move_timeout
        )
        self._fake = fake or os.environ.get("CHESS_BOT_FAKE_ENGINE", "").lower() in (
            "1",
            "true",
            "yes",
        )
        self._engines: list[_Pooled] = []
        self._init_lock = threading.Lock()
        self._rr = 0

    def available(self) -> bool:
        if self._fake:
            return True
        return bool(self.path) and (os.path.isfile(self.path) or shutil.which(self.path) is not None)

    def _spawn(self) -> UciEngine:
        if self._fake:
            return FakeUciEngine()
        if not self.available():
            raise EngineFailure(f"Stockfish binary not found at {self.path!r}")
        try:
            transport = chess.engine.SimpleEngine.popen_uci(self.path)
        except Exception as e:
            raise EngineFailure(f"Failed to start Stockfish: {e}") from e
        try:
            transport.configure({"Threads": self.threads, "Hash": self.hash_mb})
        except Exception:
            logger.exception("Stockfish base configure failed")
        return transport

    def _ensure(self) -> None:
        if self._engines:
            return
        with self._init_lock:
            if self._engines:
                return
            size = max(1, int(self.pool_size))
            for _ in range(size):
                eng = self._spawn()
                self._engines.append(_Pooled(engine=eng, lock=threading.Lock()))

    @contextmanager
    def acquire(self) -> Iterator[UciEngine]:
        self._ensure()
        with self._init_lock:
            idx = self._rr % len(self._engines)
            self._rr += 1
            pooled = self._engines[idx]
        pooled.lock.acquire()
        try:
            if not pooled.healthy:
                try:
                    pooled.engine.quit()
                except Exception:
                    pass
                pooled.engine = self._spawn()
                pooled.healthy = True
            yield pooled.engine
        except Exception:
            pooled.healthy = False
            raise
        finally:
            pooled.lock.release()

    def choose_move(self, fen: str, skill_level: int) -> str:
        """Return a UCI move string for the side to move in `fen`."""
        board = chess.Board(fen)
        if board.is_game_over():
            raise EngineFailure("Game already over")
        skill = max(0, min(20, int(skill_level)))
        deadline = time.monotonic() + float(self.move_timeout) + 2.0
        with self.acquire() as engine:
            try:
                engine.configure({"Skill Level": skill})
            except Exception as e:
                logger.warning("Skill Level configure: %s", e)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise EngineFailure("Move timed out before go")
            try:
                go_limit = chess.engine.Limit(time=min(float(self.move_timeout), remaining))
                result = engine.play(board, go_limit)
            except EngineFailure:
                raise
            except Exception as e:
                raise EngineFailure(f"Stockfish play failed: {e}") from e
        if result.move is None:
            raise EngineFailure("Stockfish returned no move")
        if result.move not in board.legal_moves:
            raise EngineFailure(f"Illegal engine move: {result.move.uci()}")
        return result.move.uci()

    def close(self) -> None:
        with self._init_lock:
            engines = self._engines
            self._engines = []
        for pooled in engines:
            try:
                pooled.engine.quit()
            except Exception:
                pass


_pool: StockfishPool | None = None
_pool_lock = threading.Lock()


def get_stockfish_pool() -> StockfishPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = StockfishPool()
    return _pool


def reset_stockfish_pool(pool: StockfishPool | None = None) -> StockfishPool:
    """Test helper: replace the process-wide pool."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
        _pool = pool if pool is not None else StockfishPool(fake=True)
        return _pool
