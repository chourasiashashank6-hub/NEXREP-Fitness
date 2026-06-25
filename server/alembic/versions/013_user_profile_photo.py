"""add user profile photo url

Revision ID: 013_user_profile_photo
Revises: 012_thread_visibility
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "013_user_profile_photo"
down_revision: Union[str, None] = "012_thread_visibility"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(512) NULL"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS profile_photo_url"))
