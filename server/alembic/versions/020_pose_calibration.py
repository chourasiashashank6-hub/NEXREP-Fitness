"""Add pose_calibration JSONB to users.

Revision ID: 020_pose_calibration
Revises: 019_session_set_tracking_method
Create Date: 2026-07-15
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "020_pose_calibration"
down_revision = "019_session_set_tracking_method"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS pose_calibration JSONB"))
    op.execute(
        sa.text(
            "ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS ai_tracking JSONB"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE workout_sessions DROP COLUMN IF EXISTS ai_tracking"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS pose_calibration"))
