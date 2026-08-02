"""add reports and thread referrals

Revision ID: 011_reports_referrals
Revises: 010_social_challenges
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "011_reports_referrals"
down_revision: Union[str, None] = "010_social_challenges"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS user_reports (
                id SERIAL PRIMARY KEY,
                reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reason VARCHAR(32) NOT NULL,
                context VARCHAR(16) NOT NULL,
                reference_id INTEGER NULL,
                details TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                status VARCHAR(16) NOT NULL DEFAULT 'open',
                CONSTRAINT ck_user_reports_not_self CHECK (reporter_id <> reported_user_id),
                CONSTRAINT ck_user_reports_reason CHECK (reason IN ('harassment', 'spam', 'inappropriate_content', 'fake_profile', 'other')),
                CONSTRAINT ck_user_reports_context CHECK (context IN ('profile', 'message', 'thread')),
                CONSTRAINT ck_user_reports_status CHECK (status IN ('open', 'reviewed', 'actioned'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_reporter_id ON user_reports(reporter_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_reported_user_id ON user_reports(reported_user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_reason ON user_reports(reason)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_context ON user_reports(context)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_reference_id ON user_reports(reference_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_created_at ON user_reports(created_at)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_reports_status ON user_reports(status)"))

    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS referral_code VARCHAR(80) NULL"))
    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS referral_description TEXT NULL"))
    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS referral_discount_text VARCHAR(160) NULL"))
    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS referral_viewed_count INTEGER NOT NULL DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE threads ADD COLUMN IF NOT EXISTS referral_copied_count INTEGER NOT NULL DEFAULT 0"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS referral_copied_count"))
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS referral_viewed_count"))
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS referral_discount_text"))
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS referral_description"))
    op.execute(sa.text("ALTER TABLE threads DROP COLUMN IF EXISTS referral_code"))
    op.execute(sa.text("DROP TABLE IF EXISTS user_reports"))
