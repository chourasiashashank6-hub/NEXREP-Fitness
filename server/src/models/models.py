from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
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
    created_at = Column(DateTime, default=datetime.utcnow)
    plan_id = Column(String(32), nullable=False, default="free")
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    needs_password_reset = Column(Boolean, nullable=False, default=False)
    subscription_status = Column(String(32), nullable=False, default="free")
    subscription_expiry = Column(DateTime(timezone=True), nullable=True)
    razorpay_subscription_id = Column(String(128), nullable=True, index=True)
    preferred_language = Column(String(32), nullable=True)

    onboarding = relationship("UserOnboarding", back_populates="user", uselist=False)


class UserOnboarding(Base):
    """Full onboarding wizard payload + computed targets, keyed by user."""

    __tablename__ = "user_onboarding"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    onboarding_json = Column(JSONB, nullable=False)
    targets_json = Column(JSONB, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="onboarding")


class Workout(Base):
    __tablename__ = "workouts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(BigInteger, ForeignKey("global_exercises.id"), nullable=True, index=True)
    type = Column(String(32), nullable=False)
    exercise_name = Column(String(120), nullable=False)
    sets = Column(Integer, nullable=True)
    reps = Column(Integer, nullable=True)
    duration = Column(Integer, nullable=True)
    notes = Column(String(255), nullable=True)
    date = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class StrengthLift(Base):
    __tablename__ = "strength_lifts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    workout_id = Column(Integer, ForeignKey("workouts.id"), nullable=True, index=True)
    exercise_id = Column(BigInteger, ForeignKey("global_exercises.id"), nullable=True, index=True)
    exercise_name = Column(String(120), nullable=False, index=True)
    weight_kg = Column(Float, nullable=False)
    reps = Column(Integer, nullable=False)
    date = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User")
    workout = relationship("Workout")


class MotivationalQuote(Base):
    __tablename__ = "motivational_quotes"

    id = Column(Integer, primary_key=True, index=True)
    quote = Column(Text, nullable=False)
    author = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False, index=True)
    notification_context = Column(String(50), nullable=False, default="general", index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PushToken(Base):
    __tablename__ = "push_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    expo_push_token = Column(String(255), nullable=False, index=True)
    platform = Column(String(16), nullable=False)
    device_id = Column(String(128), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")

    __table_args__ = (UniqueConstraint("user_id", "expo_push_token", name="uq_push_token_user_token"),)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    preferences_json = Column(JSONB, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class NotificationLog(Base):
    __tablename__ = "notification_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(64), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    body = Column(Text, nullable=False)
    event_key = Column(String(160), nullable=True, index=True)
    status = Column(String(32), nullable=False, default="queued", index=True)
    expo_ticket_id = Column(String(160), nullable=True)
    payload_json = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

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


class GlobalExercise(Base):
    __tablename__ = "global_exercises"

    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    aliases = Column(ARRAY(Text), nullable=True)
    body_part = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    equipment = Column(Text, nullable=False)
    muscles_primary = Column(ARRAY(Text), nullable=True)
    muscles_secondary = Column(ARRAY(Text), nullable=True)
    met_value = Column(Float, nullable=True)
    difficulty = Column(Text, nullable=True)
    is_compound = Column(Boolean, default=False)
    catalog_id = Column(BigInteger, ForeignKey("workout_catalog_v2.id"), nullable=True, index=True)


class GlobalExerciseLabel(Base):
    __tablename__ = "global_exercise_labels"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    exercise_id = Column(BigInteger, ForeignKey("global_exercises.id"), nullable=False, index=True)
    language_tag = Column(String(32), nullable=False, index=True)
    label = Column(Text, nullable=False)
    aliases = Column(ARRAY(Text), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("exercise_id", "language_tag", name="uq_global_exercise_label_language"),)
