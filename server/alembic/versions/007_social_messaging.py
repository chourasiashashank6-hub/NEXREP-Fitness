"""add social messaging

Revision ID: 007_social_messaging
Revises: 006_gym_threads
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007_social_messaging"
down_revision: Union[str, None] = "006_gym_threads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS dm_conversations (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                thread_id INTEGER NULL REFERENCES threads(id) ON DELETE CASCADE,
                dm_conversation_id INTEGER NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reply_to_message_id INTEGER NULL REFERENCES messages(id) ON DELETE SET NULL,
                type VARCHAR(32) NOT NULL DEFAULT 'text',
                body TEXT NULL,
                metadata JSONB NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                edited_at TIMESTAMPTZ NULL,
                deleted_at TIMESTAMPTZ NULL,
                CONSTRAINT ck_messages_one_conversation CHECK ((thread_id IS NOT NULL) <> (dm_conversation_id IS NOT NULL)),
                CONSTRAINT ck_messages_type CHECK (type IN ('text', 'location', 'referral', 'workout_share', 'stack_share', 'system'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_thread_id ON messages(thread_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_dm_conversation_id ON messages(dm_conversation_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_sender_id ON messages(sender_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_reply_to_message_id ON messages(reply_to_message_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_type ON messages(type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages(created_at)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_messages_deleted_at ON messages(deleted_at)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS dm_conversation_members (
                id SERIAL PRIMARY KEY,
                dm_conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                muted_at TIMESTAMPTZ NULL,
                last_read_message_id INTEGER NULL REFERENCES messages(id) ON DELETE SET NULL,
                CONSTRAINT uq_dm_conversation_members_conversation_user UNIQUE (dm_conversation_id, user_id)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_dm_conversation_members_dm_conversation_id ON dm_conversation_members(dm_conversation_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_dm_conversation_members_user_id ON dm_conversation_members(user_id)"))

    op.execute(
        sa.text(
            """
            ALTER TABLE thread_members
            ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER NULL REFERENCES messages(id) ON DELETE SET NULL
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE thread_members DROP COLUMN IF EXISTS last_read_message_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS dm_conversation_members"))
    op.execute(sa.text("DROP TABLE IF EXISTS messages"))
    op.execute(sa.text("DROP TABLE IF EXISTS dm_conversations"))
