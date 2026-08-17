"""Progress photos backup table for transformation timeline.

Revision ID: 029_progress_photos
Revises: 028_fasting_active_bool
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "029_progress_photos"
down_revision = "028_fasting_active_bool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS progress_photos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                taken_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                angle VARCHAR(16) NOT NULL DEFAULT 'front',
                storage_path VARCHAR(512) NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                CONSTRAINT ck_progress_photos_angle CHECK (angle IN ('front', 'side'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_progress_photos_user_id ON progress_photos(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_progress_photos_taken_at ON progress_photos(taken_at DESC)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS progress_photos"))
