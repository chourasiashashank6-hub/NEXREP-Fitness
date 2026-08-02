"""Active workout sessions + met_value defaults for global exercises."""

from alembic import op
import sqlalchemy as sa


revision = "016_workout_sessions"
down_revision = "015_meal_plan_preference_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS workout_sessions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(64) NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                plan_day_id VARCHAR(64) NOT NULL,
                started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                ended_at TIMESTAMP WITHOUT TIME ZONE,
                status VARCHAR(32) NOT NULL,
                server_kcal_total DOUBLE PRECISION NOT NULL DEFAULT 0,
                streak_incremented BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_workout_sessions_session_id ON workout_sessions (session_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_workout_sessions_user_id ON workout_sessions (user_id)"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS workout_session_set_logs (
                id SERIAL PRIMARY KEY,
                session_pk INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
                exercise_name VARCHAR(255) NOT NULL,
                set_number INTEGER NOT NULL,
                reps INTEGER NOT NULL,
                weight_kg DOUBLE PRECISION,
                started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                completed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                server_kcal DOUBLE PRECISION NOT NULL DEFAULT 0
            )
            """
        )
    )
    op.execute(
        sa.text("CREATE INDEX IF NOT EXISTS ix_workout_session_set_logs_session_pk ON workout_session_set_logs (session_pk)")
    )

    # Ensure met_value column exists and backfill sensible defaults
    op.execute(sa.text("ALTER TABLE global_exercises ADD COLUMN IF NOT EXISTS met_value DOUBLE PRECISION"))
    op.execute(sa.text("UPDATE global_exercises SET met_value = 5.0 WHERE met_value IS NULL"))
    op.execute(
        sa.text(
            """
            UPDATE global_exercises SET met_value = 6.0
            WHERE (
                lower(name) LIKE '%squat%'
                OR lower(name) LIKE '%deadlift%'
                OR lower(name) LIKE '%bench press%'
                OR lower(name) LIKE '%overhead press%'
                OR lower(name) LIKE '%barbell row%'
                OR lower(name) LIKE '%pull-up%'
                OR lower(name) LIKE '%pull up%'
                OR lower(name) LIKE '%chin-up%'
                OR lower(name) LIKE '%chin up%'
              )
              AND (met_value IS NULL OR met_value = 0 OR met_value = 5.0)
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE global_exercises SET met_value = 3.5
            WHERE (
                lower(name) LIKE '%curl%'
                OR lower(name) LIKE '%fly%'
                OR lower(name) LIKE '%extension%'
                OR lower(name) LIKE '%lateral raise%'
            )
            AND (met_value IS NULL OR met_value = 5.0 OR met_value = 0)
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS workout_session_set_logs"))
    op.execute(sa.text("DROP TABLE IF EXISTS workout_sessions"))
