from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.db.session import Base


class WeightLog(Base):
    __tablename__ = "weight_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    weight_kg = Column(Float, nullable=False)
    weight_lb = Column(Float, nullable=True)
    unit_system = Column(String, default="metric")
    note = Column(String, nullable=True)
    logged_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    log_date = Column(String, nullable=False)

    user = relationship("User", backref="weight_logs")

    __table_args__ = (
        UniqueConstraint("user_id", "log_date", name="uq_weight_log_user_date"),
    )
