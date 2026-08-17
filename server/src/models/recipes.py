"""Recipe catalog + per-user meal plan slots for meal engine v3."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.db.session import Base


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    external_id = Column(Integer, nullable=False, unique=True, index=True)
    name = Column(String(160), nullable=False)
    category = Column(String(48), nullable=False, index=True)
    diet = Column(String(16), nullable=False, index=True)
    servings = Column(Float, nullable=False)
    serving_grams = Column(Float, nullable=False)
    kcal = Column(Float, nullable=False)
    protein_g = Column(Float, nullable=False)
    fat_g = Column(Float, nullable=False)
    carbs_g = Column(Float, nullable=False)
    fibre_g = Column(Float, nullable=False, default=0)
    protein_pct_kcal = Column(Float, nullable=False)
    prep_min = Column(Integer, nullable=False)
    items = Column(JSONB, nullable=False)
    steps = Column(JSONB, nullable=False)
    slots = Column(JSONB, nullable=False)
    dietary_tags = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    assignments = relationship("UserMealPlan", back_populates="recipe")


class UserMealPlan(Base):
    __tablename__ = "user_meal_plan"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_date = Column(Date, nullable=False)
    slot = Column(String(32), nullable=False)  # breakfast | lunch | dinner | snack | …
    slot_order = Column(Integer, nullable=False, default=0)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="RESTRICT"), nullable=False, index=True)
    multiplier = Column(Float, nullable=False)
    kcal = Column(Float, nullable=False)
    protein_g = Column(Float, nullable=False)
    carbs_g = Column(Float, nullable=False)
    fat_g = Column(Float, nullable=False)
    swap_version = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    recipe = relationship("Recipe", back_populates="assignments")

    __table_args__ = (
        UniqueConstraint("user_id", "plan_date", "slot", "slot_order", name="uq_user_meal_plan_user_date_slot_order"),
    )


class UserFastingPreference(Base):
    __tablename__ = "user_fasting_preferences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    period_type = Column(String(24), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
