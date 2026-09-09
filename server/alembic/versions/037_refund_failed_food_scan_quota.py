"""Refund food scan quota rows that never produced a successful analysis."""

from __future__ import annotations

from alembic import op

revision = "037_refund_failed_food_scan_quota"
down_revision = "036_user_timezone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE ai_usage_logs AS q
        SET counts_toward_scan_quota = false
        WHERE q.feature = 'food_photo_analysis'
          AND q.provider = 'quota'
          AND q.counts_toward_scan_quota = true
          AND NOT EXISTS (
            SELECT 1
            FROM ai_usage_logs AS p
            WHERE p.user_id = q.user_id
              AND p.feature = 'food_photo_analysis'
              AND p.provider IN ('groq', 'gemini', 'openai')
              AND p.success = true
              AND p.created_at >= q.created_at
              AND p.created_at <= q.created_at + interval '15 minutes'
          )
        """
    )


def downgrade() -> None:
    pass
