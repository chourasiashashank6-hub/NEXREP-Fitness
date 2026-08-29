"""Add counts_toward_scan_quota to ai_usage_logs for failed-scan quota integrity."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "035_ai_usage_scan_quota"
down_revision = "034_subscriptions_payment_id_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_usage_logs",
        sa.Column("counts_toward_scan_quota", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        UPDATE ai_usage_logs
        SET counts_toward_scan_quota = success
        WHERE feature = 'food_photo_analysis'
        """
    )


def downgrade() -> None:
    op.drop_column("ai_usage_logs", "counts_toward_scan_quota")
