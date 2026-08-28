"""Track which health tips were shown per user per day."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "033_shown_health_tips"
down_revision = "032_ai_usage_meal_slot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shown_health_tips",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tip_id", sa.String(length=32), nullable=False),
        sa.Column("shown_on", sa.Date(), nullable=False),
        sa.UniqueConstraint("user_id", "tip_id", "shown_on", name="uq_shown_health_tip_user_tip_day"),
    )
    op.create_index("ix_shown_health_tips_user_id", "shown_health_tips", ["user_id"])
    op.create_index("ix_shown_health_tips_shown_on", "shown_health_tips", ["shown_on"])
    op.create_index("ix_shown_health_tips_user_shown_on", "shown_health_tips", ["user_id", "shown_on"])


def downgrade() -> None:
    op.drop_index("ix_shown_health_tips_user_shown_on", table_name="shown_health_tips")
    op.drop_index("ix_shown_health_tips_shown_on", table_name="shown_health_tips")
    op.drop_index("ix_shown_health_tips_user_id", table_name="shown_health_tips")
    op.drop_table("shown_health_tips")
