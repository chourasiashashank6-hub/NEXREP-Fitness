"""Reset all food scan quota counters so failed debug attempts stop blocking users."""

from __future__ import annotations

from alembic import op

revision = "038_reset_food_scan_quota"
down_revision = "037_refund_failed_food_scan_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE ai_usage_logs
        SET counts_toward_scan_quota = false
        WHERE feature = 'food_photo_analysis'
          AND provider = 'quota'
          AND counts_toward_scan_quota = true
        """
    )


def downgrade() -> None:
    pass
