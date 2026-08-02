"""Add meal plan preference snapshots."""

from alembic import op
import sqlalchemy as sa


revision = "015_meal_plan_preference_snapshots"
down_revision = "014_german_food_labels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE monthly_meal_plans ADD COLUMN IF NOT EXISTS regional_food_styles_json TEXT"))
    op.execute(sa.text("ALTER TABLE monthly_meal_plans ADD COLUMN IF NOT EXISTS diet_type VARCHAR(32)"))


def downgrade() -> None:
    op.drop_column("monthly_meal_plans", "diet_type")
    op.drop_column("monthly_meal_plans", "regional_food_styles_json")
