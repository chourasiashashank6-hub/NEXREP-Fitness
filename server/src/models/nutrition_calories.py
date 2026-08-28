from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import relationship

from src.db.session import Base


class DailyNutritionLog(Base):
    __tablename__ = "daily_nutrition_logs"
    __table_args__ = (UniqueConstraint("user_id", "log_date", name="unique_user_date"),)

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    log_date = Column(Date, nullable=False)
    total_calories = Column(Numeric(7, 2), default=0)
    total_protein_g = Column(Numeric(6, 2), default=0)
    total_carbs_g = Column(Numeric(6, 2), default=0)
    total_fat_g = Column(Numeric(6, 2), default=0)
    total_fiber_g = Column(Numeric(6, 2), default=0)
    total_water_l = Column(Numeric(4, 2), default=0)
    target_calories = Column(Integer, default=2100)
    target_protein_g = Column(Numeric(6, 2), default=158)
    target_carbs_g = Column(Numeric(6, 2), default=210)
    target_fat_g = Column(Numeric(6, 2), default=70)
    target_fiber_g = Column(Numeric(6, 2), default=30)
    target_water_l = Column(Numeric(4, 2), default=2.5)
    calories_remaining = Column(Numeric(7, 2), default=0)
    is_goal_met = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    meals = relationship("MealEntry", back_populates="daily_log", cascade="all, delete-orphan")


class MealEntry(Base):
    __tablename__ = "meal_entries"

    meal_id = Column(Integer, primary_key=True, autoincrement=True)
    log_id = Column(Integer, ForeignKey("daily_nutrition_logs.log_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    meal_type = Column(String(32), nullable=False)
    source_type = Column(String(24), nullable=False, default="database")
    food_id = Column(BigInteger, nullable=True, index=True)
    food_name = Column(String(200), nullable=False)
    quantity_g = Column(Numeric(8, 2), nullable=False)
    calories_per_100g = Column(Numeric(7, 2), nullable=False)
    protein_per_100g = Column(Numeric(6, 2), default=0)
    carbs_per_100g = Column(Numeric(6, 2), default=0)
    fat_per_100g = Column(Numeric(6, 2), default=0)
    fiber_per_100g = Column(Numeric(6, 2), default=0)
    total_calories = Column(Numeric(7, 2), nullable=False)
    total_protein_g = Column(Numeric(6, 2), default=0)
    total_carbs_g = Column(Numeric(6, 2), default=0)
    total_fat_g = Column(Numeric(6, 2), default=0)
    total_fiber_g = Column(Numeric(6, 2), default=0)
    logged_at = Column(DateTime, default=datetime.utcnow)

    daily_log = relationship("DailyNutritionLog", back_populates="meals")


class WaterIntakeLog(Base):
    __tablename__ = "water_intake_log"
    __table_args__ = (UniqueConstraint("user_id", "log_date", name="unique_user_water_date"),)

    water_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    log_date = Column(Date, nullable=False)
    total_water_l = Column(Numeric(4, 2), default=0)
    target_water_l = Column(Numeric(4, 2), default=2.5)
    is_target_met = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AIFoodMealEntry(Base):
    __tablename__ = "ai_food_meal_entries"

    ai_meal_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    log_date = Column(Date, nullable=False, index=True)
    meal_type = Column(String(32), nullable=False)
    food_name = Column(String(200), nullable=False)
    quantity_g = Column(Numeric(8, 2), nullable=False)
    calories = Column(Numeric(8, 2), default=0)
    protein = Column(Numeric(8, 2), default=0)
    carbs = Column(Numeric(8, 2), default=0)
    fat = Column(Numeric(8, 2), default=0)
    fibre = Column(Numeric(8, 2), default=0)
    confidence = Column(String(16), default="medium")
    estimated_serving_size = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ShownHealthTip(Base):
    __tablename__ = "shown_health_tips"
    __table_args__ = (
        UniqueConstraint("user_id", "tip_id", "shown_on", name="uq_shown_health_tip_user_tip_day"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tip_id = Column(String(32), nullable=False)
    shown_on = Column(Date, nullable=False, index=True)
