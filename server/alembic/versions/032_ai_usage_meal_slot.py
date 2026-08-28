"""Add meal_slot to ai_usage_logs for per-meal food scan limits."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "032_ai_usage_meal_slot"
down_revision = "031_workout_engine_v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_usage_logs", sa.Column("meal_slot", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_usage_logs", "meal_slot")
