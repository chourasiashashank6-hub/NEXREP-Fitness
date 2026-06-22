"""add canonical logging ids

Revision ID: 003_canonical_logging_ids
Revises: 002_user_preferred_language
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003_canonical_logging_ids"
down_revision: Union[str, None] = "002_user_preferred_language"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE workouts ADD COLUMN IF NOT EXISTS exercise_id BIGINT NULL"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_workouts_exercise_id ON workouts(exercise_id)"))
    op.execute(sa.text("ALTER TABLE strength_lifts ADD COLUMN IF NOT EXISTS exercise_id BIGINT NULL"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_strength_lifts_exercise_id ON strength_lifts(exercise_id)"))
    op.execute(sa.text("ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS food_id BIGINT NULL"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_meal_entries_food_id ON meal_entries(food_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_meal_entries_food_id"))
    op.execute(sa.text("ALTER TABLE meal_entries DROP COLUMN IF EXISTS food_id"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_strength_lifts_exercise_id"))
    op.execute(sa.text("ALTER TABLE strength_lifts DROP COLUMN IF EXISTS exercise_id"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_workouts_exercise_id"))
    op.execute(sa.text("ALTER TABLE workouts DROP COLUMN IF EXISTS exercise_id"))
