"""Add slot_order + widen slot for multi-meal days.

Revision ID: 022_user_meal_plan_slot_order
Revises: 021_recipes_meal_engine_v3
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "022_user_meal_plan_slot_order"
down_revision = "021_recipes_meal_engine_v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE user_meal_plan ADD COLUMN IF NOT EXISTS slot_order INTEGER NOT NULL DEFAULT 0"))
    op.execute(
        sa.text(
            """
            UPDATE user_meal_plan
            SET slot_order = CASE slot
              WHEN 'breakfast' THEN 0
              WHEN 'lunch' THEN 1
              WHEN 'dinner' THEN 2
              ELSE 0
            END
            WHERE slot_order = 0
            """
        )
    )
    op.execute(sa.text("ALTER TABLE user_meal_plan ALTER COLUMN slot TYPE VARCHAR(32)"))
    op.execute(sa.text("ALTER TABLE user_meal_plan DROP CONSTRAINT IF EXISTS uq_user_meal_plan_user_date_slot"))
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_meal_plan_user_date_slot_order'
              ) THEN
                ALTER TABLE user_meal_plan
                  ADD CONSTRAINT uq_user_meal_plan_user_date_slot_order
                  UNIQUE (user_id, plan_date, slot, slot_order);
              END IF;
            END $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE user_meal_plan DROP CONSTRAINT IF EXISTS uq_user_meal_plan_user_date_slot_order"))
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_meal_plan_user_date_slot'
              ) THEN
                ALTER TABLE user_meal_plan
                  ADD CONSTRAINT uq_user_meal_plan_user_date_slot
                  UNIQUE (user_id, plan_date, slot);
              END IF;
            END $$;
            """
        )
    )
    op.execute(sa.text("ALTER TABLE user_meal_plan DROP COLUMN IF EXISTS slot_order"))
