"""add user preferred language

Revision ID: 002_user_preferred_language
Revises: 001_initial
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_user_preferred_language"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(32) NULL"))


def downgrade() -> None:
    op.drop_column("users", "preferred_language")
