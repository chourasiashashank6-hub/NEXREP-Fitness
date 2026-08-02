"""add supplement stacks

Revision ID: 008_supplement_stacks
Revises: 007_social_messaging
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008_supplement_stacks"
down_revision: Union[str, None] = "007_social_messaging"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS stack_visibility BOOLEAN NOT NULL DEFAULT TRUE
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS user_supplement_stack (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                category VARCHAR(32) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity_note VARCHAR(255) NULL,
                timing_type VARCHAR(32) NOT NULL,
                timing_value VARCHAR(255) NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_user_supplement_stack_category CHECK (
                    category IN ('protein', 'creatine', 'preworkout', 'bcaa', 'multivitamin', 'other')
                ),
                CONSTRAINT ck_user_supplement_stack_timing_type CHECK (
                    timing_type IN ('time_of_day', 'relative_to_workout', 'custom_text')
                )
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_supplement_stack_user_id ON user_supplement_stack(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_supplement_stack_category ON user_supplement_stack(category)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_supplement_stack_sort_order ON user_supplement_stack(sort_order)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_supplement_stack"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS stack_visibility"))
