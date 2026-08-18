"""Coach Journey Engine — journey_events table.

Revision ID: 030_journey_events
Revises: 029_progress_photos
Create Date: 2026-08-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "030_journey_events"
down_revision = "029_progress_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS journey_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                domain VARCHAR(32) NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                detected_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                resolved_at TIMESTAMP WITHOUT TIME ZONE NULL,
                payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_journey_events_user_id ON journey_events(user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_journey_events_domain ON journey_events(domain)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_journey_events_event_type ON journey_events(event_type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_journey_events_status ON journey_events(status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_journey_events_detected_at ON journey_events(detected_at)"))
    op.execute(
        sa.text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_events_active_pattern
            ON journey_events (
                user_id,
                domain,
                event_type,
                ((payload_json->>'pattern_key'))
            )
            WHERE status = 'active'
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS uq_journey_events_active_pattern"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_journey_events_detected_at"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_journey_events_status"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_journey_events_event_type"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_journey_events_domain"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_journey_events_user_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS journey_events"))
