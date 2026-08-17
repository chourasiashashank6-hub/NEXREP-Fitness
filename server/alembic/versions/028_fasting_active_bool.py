"""Fix user_fasting_preferences.active column type to BOOLEAN.

Revision ID: 028_fasting_active_bool
Revises: 027_fasting_meals
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "028_fasting_active_bool"
down_revision = "027_fasting_meals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'user_fasting_preferences'
                  AND column_name = 'active'
                  AND data_type = 'integer'
              ) THEN
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active DROP DEFAULT;
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active TYPE BOOLEAN USING (active <> 0);
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active SET DEFAULT TRUE;
              END IF;
            END $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'user_fasting_preferences'
                  AND column_name = 'active'
                  AND data_type = 'boolean'
              ) THEN
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active DROP DEFAULT;
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active TYPE INTEGER USING (CASE WHEN active THEN 1 ELSE 0 END);
                ALTER TABLE user_fasting_preferences
                  ALTER COLUMN active SET DEFAULT 1;
              END IF;
            END $$;
            """
        )
    )
