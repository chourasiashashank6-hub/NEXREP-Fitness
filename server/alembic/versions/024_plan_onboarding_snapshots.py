"""Add onboarding_snapshot_json to meal and workout plan tables.

Revision ID: 024_plan_onboarding_snapshots
Revises: 023_recipes_fibre_g
Create Date: 2026-07-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "024_plan_onboarding_snapshots"
down_revision = "023_recipes_fibre_g"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE monthly_meal_plans "
            "ADD COLUMN IF NOT EXISTS onboarding_snapshot_json TEXT"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE monthly_workout_plans "
            "ADD COLUMN IF NOT EXISTS onboarding_snapshot_json TEXT"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE monthly_meal_plans DROP COLUMN IF EXISTS onboarding_snapshot_json"))
    op.execute(sa.text("ALTER TABLE monthly_workout_plans DROP COLUMN IF EXISTS onboarding_snapshot_json"))
