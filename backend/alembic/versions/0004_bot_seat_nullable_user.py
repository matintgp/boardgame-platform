"""Allow null game_seats.user_id for chess bot opponents.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "game_seats",
        "user_id",
        existing_type=sa.UUID(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "game_seats",
        "user_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
