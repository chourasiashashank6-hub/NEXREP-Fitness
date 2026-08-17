"""Progress XP tables: xp_events, user_xp_totals, xp_seasons.

Revision ID: 025_progress_xp
Revises: 024_plan_onboarding_snapshots
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "025_progress_xp"
down_revision = "024_plan_onboarding_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS xp_seasons (
                id SERIAL PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_xp_seasons_start_date ON xp_seasons(start_date)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_xp_seasons_end_date ON xp_seasons(end_date)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS xp_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                event_type VARCHAR(64) NOT NULL,
                xp_amount INTEGER NOT NULL,
                metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_xp_events_user_id ON xp_events(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_xp_events_event_type ON xp_events(event_type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_xp_events_created_at ON xp_events(created_at)"))
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_xp_events_user_idempotency "
            "ON xp_events(user_id, ((metadata_json->>'idempotency_key')))"
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS user_xp_totals (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                total_xp INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 1,
                comeback_sessions_remaining INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
            )
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_xp_totals"))
    op.execute(sa.text("DROP TABLE IF EXISTS xp_events"))
    op.execute(sa.text("DROP TABLE IF EXISTS xp_seasons"))
