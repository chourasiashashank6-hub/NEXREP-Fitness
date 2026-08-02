"""Add tracking_method to workout_session_set_logs.

Revision ID: 019_session_set_tracking_method
Revises: 018_food_item_region_supplement
Create Date: 2026-07-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "019_session_set_tracking_method"
down_revision = "018_food_item_region_supplement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE workout_session_set_logs
            ADD COLUMN IF NOT EXISTS tracking_method VARCHAR(32) NOT NULL DEFAULT 'manual'
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE workout_session_set_logs DROP COLUMN IF EXISTS tracking_method"))
