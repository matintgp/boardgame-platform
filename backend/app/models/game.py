import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, Timestamped, utcnow


class GameStatus(str, enum.Enum):
    waiting = "waiting"      # lobby open, players joining
    active = "active"        # game in progress
    finished = "finished"
    aborted = "aborted"


class GameSeat(Base):
    __tablename__ = "game_seats"
    __table_args__ = (UniqueConstraint("game_id", "seat", name="uq_game_seat"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    game_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("games.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Nullable for bot seats (opponent_type=bot; no fake human account).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    seat: Mapped[int] = mapped_column(Integer, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    game: Mapped["Game"] = relationship(back_populates="seats")


class Game(Base, Timestamped):
    __tablename__ = "games"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    game_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[GameStatus] = mapped_column(
        String(16), default=GameStatus.waiting.value, nullable=False, index=True
    )
    max_players: Mapped[int] = mapped_column(Integer, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    # Materialized engine state cache. Source of truth is game_events (replayable).
    state: Mapped[dict | None] = mapped_column(JSONType)
    last_seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONType)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    seats: Mapped[list[GameSeat]] = relationship(back_populates="game", cascade="all, delete")


Index("ix_games_status_type", Game.status, Game.game_type)
