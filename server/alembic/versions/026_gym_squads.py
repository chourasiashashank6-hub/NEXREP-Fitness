"""Gym squads: squads + squad_members.

Revision ID: 026_gym_squads
Revises: 025_progress_xp
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "026_gym_squads"
down_revision = "025_progress_xp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS squads (
                id SERIAL PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                max_members INTEGER NOT NULL DEFAULT 6,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                CONSTRAINT ck_squads_status CHECK (status IN ('active', 'cancelled')),
                CONSTRAINT ck_squads_max_members CHECK (max_members >= 2 AND max_members <= 12)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_squads_creator_id ON squads(creator_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_squads_status ON squads(status)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS squad_members (
                squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(16) NOT NULL DEFAULT 'member',
                status VARCHAR(16) NOT NULL DEFAULT 'invited',
                joined_at TIMESTAMP WITHOUT TIME ZONE NULL,
                share_status BOOLEAN NOT NULL DEFAULT FALSE,
                PRIMARY KEY (squad_id, user_id),
                CONSTRAINT ck_squad_members_role CHECK (role IN ('creator', 'member')),
                CONSTRAINT ck_squad_members_status CHECK (status IN ('invited', 'joined', 'left', 'declined'))
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_squad_members_user_id ON squad_members(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_squad_members_status ON squad_members(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_squad_members_share_status ON squad_members(share_status)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS squad_members"))
    op.execute(sa.text("DROP TABLE IF EXISTS squads"))
