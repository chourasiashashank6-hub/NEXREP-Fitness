"""add social friendships

Revision ID: 005_social_friendships
Revises: 004_catalog_language_labels
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005_social_friendships"
down_revision: Union[str, None] = "004_catalog_language_labels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS friendships (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(16) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                accepted_at TIMESTAMPTZ NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_friendships_not_self CHECK (user_id <> friend_id),
                CONSTRAINT ck_friendships_status CHECK (status IN ('pending', 'accepted', 'blocked'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_friendships_user_id ON friendships(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_friendships_friend_id ON friendships(friend_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_friendships_status ON friendships(status)"))
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_user_pair
            ON friendships (LEAST(user_id, friend_id), GREATEST(user_id, friend_id))
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS friend_request_daily_counts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                request_date DATE NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_friend_request_daily_counts_user_date UNIQUE (user_id, request_date)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_friend_request_daily_counts_user_id ON friend_request_daily_counts(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_friend_request_daily_counts_request_date ON friend_request_daily_counts(request_date)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS friend_request_daily_counts"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_friendships_user_pair"))
    op.execute(sa.text("DROP TABLE IF EXISTS friendships"))
