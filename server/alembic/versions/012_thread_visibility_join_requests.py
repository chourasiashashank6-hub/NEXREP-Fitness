"""add thread visibility and join requests

Revision ID: 012_thread_visibility
Revises: 011_reports_referrals
Create Date: 2026-06-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "012_thread_visibility"
down_revision: Union[str, None] = "011_reports_referrals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'private'"))
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'ck_threads_visibility'
                ) THEN
                    ALTER TABLE threads
                    ADD CONSTRAINT ck_threads_visibility CHECK (visibility IN ('public', 'private'));
                END IF;
            END $$;
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_threads_visibility ON threads(visibility)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS thread_join_requests (
                id SERIAL PRIMARY KEY,
                thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                responded_at TIMESTAMPTZ NULL,
                CONSTRAINT uq_thread_join_requests_thread_requester UNIQUE (thread_id, requester_user_id),
                CONSTRAINT ck_thread_join_requests_status CHECK (status IN ('pending', 'approved', 'declined'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_join_requests_thread_id ON thread_join_requests(thread_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_join_requests_requester_user_id ON thread_join_requests(requester_user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_join_requests_status ON thread_join_requests(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_thread_join_requests_created_at ON thread_join_requests(created_at)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS thread_join_requests"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_threads_visibility"))
    op.execute(sa.text("ALTER TABLE threads DROP CONSTRAINT IF EXISTS ck_threads_visibility"))
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS visibility"))
