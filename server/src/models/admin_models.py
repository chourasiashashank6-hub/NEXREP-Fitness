from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from src.db.session import Base


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(120), nullable=False)
    role = Column(String(32), default="owner")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id = Column(String(32), nullable=False)
    billing_cycle = Column(String(16), nullable=False)
    status = Column(String(32), nullable=False, default="active")
    price_inr = Column(Numeric(10, 2), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    razorpay_subscription_id = Column(String(128), nullable=True, unique=True)
    razorpay_order_id = Column(String(128), nullable=True)
    razorpay_payment_id = Column(String(128), nullable=True)
    razorpay_signature = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User")


class AiUsageLog(Base):
    __tablename__ = "ai_usage_logs"
    __table_args__ = (
        Index("ix_ai_usage_user_created", "user_id", "created_at"),
        Index("ix_ai_usage_feature_created", "feature", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    feature = Column(String(64), nullable=False)
    provider = Column(String(16), nullable=False)
    model = Column(String(128), nullable=False)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Numeric(12, 8), nullable=False, default=0)
    cost_inr = Column(Numeric(12, 4), nullable=False, default=0)
    success = Column(Boolean, nullable=False, default=True)
    is_fallback = Column(Boolean, nullable=False, default=False)
    counts_toward_scan_quota = Column(Boolean, nullable=False, default=False)
    endpoint = Column(String(128), nullable=True)
    meal_slot = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class SwapUsageLog(Base):
    __tablename__ = "swap_usage_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    swap_type = Column(String(16), nullable=False)
    swap_date = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserActivityLog(Base):
    __tablename__ = "user_activity_logs"
    __table_args__ = (UniqueConstraint("user_id", "event_date", name="uq_user_activity_per_day"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_date = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
