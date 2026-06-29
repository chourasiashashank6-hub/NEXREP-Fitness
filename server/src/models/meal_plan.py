from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from src.db.session import Base


class MonthlyMealPlan(Base):
    __tablename__ = "monthly_meal_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    budget_level = Column(String(32), nullable=False)
    regional_food_styles_json = Column(Text, nullable=True)  # JSON list snapshot from onboarding
    diet_type = Column(String(32), nullable=True)  # snapshot from onboarding
    generated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    source = Column(String(32), default="groq")
    target_kcal = Column(Integer, nullable=True)
    target_protein_g = Column(Integer, nullable=True)
    target_carbs_g = Column(Integer, nullable=True)
    target_fat_g = Column(Integer, nullable=True)
    target_fiber_g = Column(Integer, nullable=True)
    week_start_day = Column(Integer, nullable=True)
    week_end_day = Column(Integer, nullable=True)
    generation_mode = Column(String(32), nullable=False, default="weekly")
    day_regens_used = Column(Integer, default=0, nullable=False)
    day_regens_limit = Column(Integer, default=3, nullable=False)

    entries = relationship("DailyMealPlanEntry", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id", "month", "year", "week_start_day", name="uq_meal_plan_user_month_week"),
    )


class DailyMealPlanEntry(Base):
    __tablename__ = "daily_meal_plan_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Integer, ForeignKey("monthly_meal_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    day = Column(Integer, nullable=False)
    is_cheat_day = Column(Boolean, default=False)
    total_calories = Column(Integer, nullable=False)
    total_protein_g = Column(Integer, nullable=False)
    total_carbs_g = Column(Integer, nullable=False)
    total_fat_g = Column(Integer, nullable=False)
    total_fiber_g = Column(Integer, nullable=False)
    meals_json = Column(Text, nullable=False)

    plan = relationship("MonthlyMealPlan", back_populates="entries")

    __table_args__ = (UniqueConstraint("plan_id", "day", name="uq_meal_plan_day"),)


class MonthlyWorkoutPlan(Base):
    __tablename__ = "monthly_workout_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    focus_muscle = Column(String(64), nullable=True)  # legacy single focus; first muscle when set
    focus_muscles_json = Column(Text, nullable=True)  # JSON array e.g. ["Chest", "Back"]
    generated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    source = Column(String(32), default="groq")
    day_regens_used = Column(Integer, default=0, nullable=False)
    day_regens_limit = Column(Integer, default=2, nullable=False)
    month_plan_regens_used = Column(Integer, default=0, nullable=False)
    month_plan_regens_limit = Column(Integer, default=2, nullable=False)

    entries = relationship("DailyWorkoutPlanEntry", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("user_id", "month", "year", name="uq_workout_plan_user_month"),)


class DailyWorkoutPlanEntry(Base):
    __tablename__ = "daily_workout_plan_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Integer, ForeignKey("monthly_workout_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    day = Column(Integer, nullable=False)
    is_rest_day = Column(Boolean, default=False)
    split_name = Column(String(120), nullable=False)
    focus_muscles_json = Column(Text, nullable=False)
    exercises_json = Column(Text, nullable=False)
    estimated_duration_min = Column(Integer, nullable=False)

    plan = relationship("MonthlyWorkoutPlan", back_populates="entries")

    __table_args__ = (UniqueConstraint("plan_id", "day", name="uq_workout_plan_day"),)
