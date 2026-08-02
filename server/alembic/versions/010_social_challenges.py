"""add social challenges

Revision ID: 010_social_challenges
Revises: 009_activity_feed
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010_social_challenges"
down_revision: Union[str, None] = "009_activity_feed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS challenges (
                id SERIAL PRIMARY KEY,
                creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(32) NOT NULL,
                title VARCHAR(160) NOT NULL,
                target INTEGER NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                winner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_challenges_type CHECK (type IN ('streak_battle', 'workout_count')),
                CONSTRAINT ck_challenges_status CHECK (status IN ('active', 'completed', 'cancelled')),
                CONSTRAINT ck_challenges_target_positive CHECK (target > 0),
                CONSTRAINT ck_challenges_date_order CHECK (end_date >= start_date)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_creator_id ON challenges(creator_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_type ON challenges(type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_start_date ON challenges(start_date)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_end_date ON challenges(end_date)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_status ON challenges(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenges_winner_user_id ON challenges(winner_user_id)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS challenge_participants (
                challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                progress INTEGER NOT NULL DEFAULT 0,
                joined_at TIMESTAMPTZ NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'invited',
                target_reached_at TIMESTAMPTZ NULL,
                PRIMARY KEY (challenge_id, user_id),
                CONSTRAINT ck_challenge_participants_progress_nonnegative CHECK (progress >= 0),
                CONSTRAINT ck_challenge_participants_status CHECK (status IN ('invited', 'joined', 'declined', 'left'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenge_participants_challenge_id ON challenge_participants(challenge_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenge_participants_user_id ON challenge_participants(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenge_participants_status ON challenge_participants(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_challenge_participants_target_reached_at ON challenge_participants(target_reached_at)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS challenge_participants"))
    op.execute(sa.text("DROP TABLE IF EXISTS challenges"))
