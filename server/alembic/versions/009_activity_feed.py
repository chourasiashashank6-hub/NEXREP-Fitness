"""add activity feed

Revision ID: 009_activity_feed
Revises: 008_supplement_stacks
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009_activity_feed"
down_revision: Union[str, None] = "008_supplement_stacks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS activity_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(32) NOT NULL,
                payload JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                visibility VARCHAR(16) NOT NULL DEFAULT 'friends',
                deleted_at TIMESTAMPTZ NULL,
                CONSTRAINT ck_activity_events_type CHECK (type IN ('pr', 'streak_milestone', 'thread_joined')),
                CONSTRAINT ck_activity_events_visibility CHECK (visibility IN ('friends', 'private'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_user_id ON activity_events(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_type ON activity_events(type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_created_at ON activity_events(created_at)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_visibility ON activity_events(visibility)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_deleted_at ON activity_events(deleted_at)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_activity_events_payload_gin ON activity_events USING GIN (payload)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS feed_reactions (
                event_id INTEGER NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(16) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (event_id, user_id, type),
                CONSTRAINT ck_feed_reactions_type CHECK (type IN ('flame', 'clap'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_feed_reactions_event_id ON feed_reactions(event_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_feed_reactions_user_id ON feed_reactions(user_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS feed_reactions"))
    op.execute(sa.text("DROP TABLE IF EXISTS activity_events"))
