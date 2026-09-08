"""Add per-user IANA timezone for scheduled push notifications."""

from alembic import op
import sqlalchemy as sa

revision = "036_user_timezone"
down_revision = "035_ai_usage_scan_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
    )


def downgrade() -> None:
    op.drop_column("users", "timezone")
