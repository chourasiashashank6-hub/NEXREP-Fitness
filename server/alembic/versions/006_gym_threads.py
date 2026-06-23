"""add gym threads

Revision ID: 006_gym_threads
Revises: 005_social_friendships
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006_gym_threads"
down_revision: Union[str, None] = "005_social_friendships"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS threads (
                id SERIAL PRIMARY KEY,
                host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(160) NOT NULL,
                gym_name VARCHAR(255) NOT NULL,
                gym_place_id VARCHAR(255) NULL,
                scheduled_time TIMESTAMPTZ NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                max_members INTEGER NOT NULL DEFAULT 20,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                CONSTRAINT ck_threads_status CHECK (status IN ('active', 'completed', 'cancelled')),
                CONSTRAINT ck_threads_max_members_positive CHECK (max_members > 0)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_host_user_id ON threads(host_user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_gym_place_id ON threads(gym_place_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_scheduled_time ON threads(scheduled_time)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_status ON threads(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_expires_at ON threads(expires_at)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS thread_members (
                id SERIAL PRIMARY KEY,
                thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(16) NOT NULL DEFAULT 'member',
                status VARCHAR(16) NOT NULL DEFAULT 'invited',
                joined_at TIMESTAMPTZ NULL,
                CONSTRAINT uq_thread_members_thread_user UNIQUE (thread_id, user_id),
                CONSTRAINT ck_thread_members_role CHECK (role IN ('host', 'member')),
                CONSTRAINT ck_thread_members_status CHECK (status IN ('invited', 'joined', 'declined'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_members_thread_id ON thread_members(thread_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_members_user_id ON thread_members(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_members_role ON thread_members(role)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_members_status ON thread_members(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_members_joined_at ON thread_members(joined_at)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS thread_mutes (
                id SERIAL PRIMARY KEY,
                thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                muted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_thread_mutes_thread_user UNIQUE (thread_id, user_id)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_mutes_thread_id ON thread_mutes(thread_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_mutes_user_id ON thread_mutes(user_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS thread_mutes"))
    op.execute(sa.text("DROP TABLE IF EXISTS thread_members"))
    op.execute(sa.text("DROP TABLE IF EXISTS threads"))
