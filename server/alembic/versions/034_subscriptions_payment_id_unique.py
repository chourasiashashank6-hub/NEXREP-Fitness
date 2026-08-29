"""Add partial unique index on subscriptions.razorpay_payment_id for webhook idempotency."""

from alembic import op

revision = "034_subscriptions_payment_id_unique"
down_revision = "033_shown_health_tips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_subscriptions_razorpay_payment_id_unique
        ON subscriptions (razorpay_payment_id)
        WHERE razorpay_payment_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_subscriptions_razorpay_payment_id_unique")
