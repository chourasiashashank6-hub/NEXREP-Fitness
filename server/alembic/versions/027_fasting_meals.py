"""Fasting-aware meals: dietary_tags on recipes + user_fasting_preferences.

Revision ID: 027_fasting_meals
Revises: 026_gym_squads
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "027_fasting_meals"
down_revision = "026_gym_squads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE recipes
            ADD COLUMN IF NOT EXISTS dietary_tags JSONB NULL DEFAULT '[]'::jsonb
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS user_fasting_preferences (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                period_type VARCHAR(24) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                CONSTRAINT ck_user_fasting_period_type
                    CHECK (period_type IN ('navratri', 'ramadan', 'ekadashi', 'custom')),
                CONSTRAINT ck_user_fasting_date_range CHECK (end_date >= start_date)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_fasting_preferences_user_id ON user_fasting_preferences(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_fasting_preferences_active ON user_fasting_preferences(active)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_fasting_preferences"))
    op.execute(sa.text("ALTER TABLE recipes DROP COLUMN IF EXISTS dietary_tags"))
