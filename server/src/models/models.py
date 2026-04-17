from datetime import datetime
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from src.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    age = Column(Integer, default=25)
    weight = Column(Float, default=70)
    goals = Column(String(255), default="Stay consistent")
    goal_tag = Column(String(128), default="Fat Loss")
    difficulty = Column(String(64), default="Beginner")


class Workout(Base):
    __tablename__ = "workouts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String(32), nullable=False)
    exercise_name = Column(String(120), nullable=False)
    sets = Column(Integer, nullable=True)
    reps = Column(Integer, nullable=True)
    duration = Column(Integer, nullable=True)
    notes = Column(String(255), nullable=True)
    date = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(120), nullable=False)
    calories = Column(Integer, nullable=False)
    protein = Column(Integer, nullable=True)
    carbs = Column(Integer, nullable=True)
    fat = Column(Integer, nullable=True)
    date = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String(32), nullable=False)
    title = Column(String(120), nullable=False)
    calories = Column(Integer, nullable=True)
    duration = Column(Integer, nullable=True)
    intensity = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class WorkoutCatalog(Base):
    __tablename__ = "workout_catalog_v2"

    id = Column(Integer, primary_key=True, index=True)
    exercise_name = Column(String(255), nullable=False, index=True)
    body_part = Column(String(128), nullable=False, index=True, default="Full Body")
    type = Column(String(64), nullable=False, index=True)
    equipment = Column(String(128), nullable=False, index=True)
    difficulty = Column(String(64), nullable=False, index=True)
    met_value = Column(Float, nullable=True, default=0)
    goal_tag = Column(String(128), nullable=False, index=True, default="General")
    sets_recommended = Column(String(32), nullable=True)
    reps_recommended = Column(String(32), nullable=True)
    rest_time_sec = Column(Integer, nullable=True)
    recommended_weight_kg = Column(String(64), nullable=True)
    video_url = Column(String(512), nullable=True)
