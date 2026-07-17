"""Add fibre_g to recipes for meal engine v3 seed.

Revision ID: 023_recipes_fibre_g
Revises: 022_user_meal_plan_slot_order
Create Date: 2026-07-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "023_recipes_fibre_g"
down_revision = "022_user_meal_plan_slot_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE recipes
            ADD COLUMN IF NOT EXISTS fibre_g FLOAT NOT NULL DEFAULT 0
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE recipes DROP COLUMN IF EXISTS fibre_g"))
