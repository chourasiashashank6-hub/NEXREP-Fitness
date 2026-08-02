"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-05-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_password_reset BOOLEAN NOT NULL DEFAULT FALSE"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(32) NOT NULL DEFAULT 'free'"
        )
    )
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMPTZ NULL"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(128) NULL"))
    op.execute(sa.text("ALTER TABLE monthly_workout_plans ADD COLUMN IF NOT EXISTS day_regens_used INTEGER DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE monthly_workout_plans ADD COLUMN IF NOT EXISTS day_regens_limit INTEGER DEFAULT 2"))
    op.execute(sa.text("UPDATE monthly_workout_plans SET day_regens_used = 0 WHERE day_regens_used IS NULL"))
    op.execute(sa.text("UPDATE monthly_workout_plans SET day_regens_limit = 2 WHERE day_regens_limit IS NULL"))
    op.execute(sa.text("ALTER TABLE monthly_workout_plans ADD COLUMN IF NOT EXISTS month_plan_regens_used INTEGER DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE monthly_workout_plans ADD COLUMN IF NOT EXISTS month_plan_regens_limit INTEGER DEFAULT 2"))
    op.execute(sa.text("UPDATE monthly_workout_plans SET month_plan_regens_used = 0 WHERE month_plan_regens_used IS NULL"))
    op.execute(sa.text("UPDATE monthly_workout_plans SET month_plan_regens_limit = 2 WHERE month_plan_regens_limit IS NULL"))


def downgrade() -> None:
    op.drop_column("monthly_workout_plans", "month_plan_regens_limit")
    op.drop_column("monthly_workout_plans", "month_plan_regens_used")
    op.drop_column("monthly_workout_plans", "day_regens_limit")
    op.drop_column("monthly_workout_plans", "day_regens_used")
    op.drop_column("users", "razorpay_subscription_id")
    op.drop_column("users", "subscription_expiry")
    op.drop_column("users", "subscription_status")
    op.drop_column("users", "needs_password_reset")
