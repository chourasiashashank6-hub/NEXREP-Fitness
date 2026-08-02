"""Add recipes + user_meal_plan for meal engine v3.

Revision ID: 021_recipes_meal_engine_v3
Revises: 020_pose_calibration
Create Date: 2026-07-16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "021_recipes_meal_engine_v3"
down_revision = "020_pose_calibration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_all may have already created these tables in local/dev — be idempotent.
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS recipes (
              id SERIAL PRIMARY KEY,
              external_id INTEGER NOT NULL,
              name VARCHAR(160) NOT NULL,
              category VARCHAR(48) NOT NULL,
              diet VARCHAR(16) NOT NULL,
              servings FLOAT NOT NULL,
              serving_grams FLOAT NOT NULL,
              kcal FLOAT NOT NULL,
              protein_g FLOAT NOT NULL,
              fat_g FLOAT NOT NULL,
              carbs_g FLOAT NOT NULL,
              fibre_g FLOAT NOT NULL DEFAULT 0,
              protein_pct_kcal FLOAT NOT NULL,
              prep_min INTEGER NOT NULL,
              items JSONB NOT NULL,
              steps JSONB NOT NULL,
              slots JSONB NOT NULL,
              created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
              CONSTRAINT uq_recipes_external_id UNIQUE (external_id)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_recipes_category ON recipes (category)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_recipes_diet ON recipes (diet)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_recipes_external_id ON recipes (external_id)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS user_meal_plan (
              id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              plan_date DATE NOT NULL,
              slot VARCHAR(16) NOT NULL,
              recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
              multiplier FLOAT NOT NULL,
              kcal FLOAT NOT NULL,
              protein_g FLOAT NOT NULL,
              carbs_g FLOAT NOT NULL,
              fat_g FLOAT NOT NULL,
              swap_version INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
              CONSTRAINT uq_user_meal_plan_user_date_slot UNIQUE (user_id, plan_date, slot)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_meal_plan_user_date ON user_meal_plan (user_id, plan_date)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_meal_plan_recipe ON user_meal_plan (recipe_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_meal_plan_user_id ON user_meal_plan (user_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_meal_plan"))
    op.execute(sa.text("DROP TABLE IF EXISTS recipes"))
