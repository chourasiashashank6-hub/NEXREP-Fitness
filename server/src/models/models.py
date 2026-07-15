from datetime import datetime
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
    stack_visibility = Column(Boolean, nullable=False, default=True)
    profile_photo_url = Column(String(512), nullable=True)
    pose_calibration = Column(JSONB, nullable=True)

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


class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    friend_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(16), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    friend = relationship("User", foreign_keys=[friend_id])

    __table_args__ = (
        CheckConstraint("user_id <> friend_id", name="ck_friendships_not_self"),
        CheckConstraint("status IN ('pending', 'accepted', 'blocked')", name="ck_friendships_status"),
    )


class FriendRequestDailyCount(Base):
    __tablename__ = "friend_request_daily_counts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    request_date = Column(Date, nullable=False, index=True)
    count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")

    __table_args__ = (UniqueConstraint("user_id", "request_date", name="uq_friend_request_daily_counts_user_date"),)


class UserReport(Base):
    __tablename__ = "user_reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reported_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reason = Column(String(32), nullable=False, index=True)
    context = Column(String(16), nullable=False, index=True)
    reference_id = Column(Integer, nullable=True, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    status = Column(String(16), nullable=False, default="open", index=True)

    reporter = relationship("User", foreign_keys=[reporter_id])
    reported_user = relationship("User", foreign_keys=[reported_user_id])

    __table_args__ = (
        CheckConstraint("reporter_id <> reported_user_id", name="ck_user_reports_not_self"),
        CheckConstraint(
            "reason IN ('harassment', 'spam', 'inappropriate_content', 'fake_profile', 'other')",
            name="ck_user_reports_reason",
        ),
        CheckConstraint("context IN ('profile', 'message', 'thread')", name="ck_user_reports_context"),
        CheckConstraint("status IN ('open', 'reviewed', 'actioned')", name="ck_user_reports_status"),
    )


class UserSupplementStack(Base):
    __tablename__ = "user_supplement_stack"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(32), nullable=False, index=True)
    product_name = Column(String(255), nullable=False)
    quantity_note = Column(String(255), nullable=True)
    timing_type = Column(String(32), nullable=False)
    timing_value = Column(String(255), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")

    __table_args__ = (
        CheckConstraint(
            "category IN ('protein', 'creatine', 'preworkout', 'bcaa', 'multivitamin', 'other')",
            name="ck_user_supplement_stack_category",
        ),
        CheckConstraint(
            "timing_type IN ('time_of_day', 'relative_to_workout', 'custom_text')",
            name="ck_user_supplement_stack_timing_type",
        ),
    )


class Thread(Base):
    __tablename__ = "threads"

    id = Column(Integer, primary_key=True, index=True)
    host_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    gym_name = Column(String(255), nullable=False)
    gym_place_id = Column(String(255), nullable=True, index=True)
    scheduled_time = Column(DateTime, nullable=False, index=True)
    status = Column(String(16), nullable=False, default="active", index=True)
    visibility = Column(String(16), nullable=False, default="private", index=True)
    max_members = Column(Integer, nullable=False, default=20)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    referral_code = Column(String(80), nullable=True)
    referral_description = Column(Text, nullable=True)
    referral_discount_text = Column(String(160), nullable=True)
    referral_viewed_count = Column(Integer, nullable=False, default=0)
    referral_copied_count = Column(Integer, nullable=False, default=0)

    host = relationship("User", foreign_keys=[host_user_id])
    members = relationship("ThreadMember", back_populates="thread", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("status IN ('active', 'completed', 'cancelled')", name="ck_threads_status"),
        CheckConstraint("visibility IN ('public', 'private')", name="ck_threads_visibility"),
        CheckConstraint("max_members > 0", name="ck_threads_max_members_positive"),
    )


class ThreadMember(Base):
    __tablename__ = "thread_members"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False, default="member", index=True)
    status = Column(String(16), nullable=False, default="invited", index=True)
    joined_at = Column(DateTime, nullable=True, index=True)
    last_read_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

    thread = relationship("Thread", back_populates="members")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("thread_id", "user_id", name="uq_thread_members_thread_user"),
        CheckConstraint("role IN ('host', 'member')", name="ck_thread_members_role"),
        CheckConstraint("status IN ('invited', 'joined', 'declined')", name="ck_thread_members_status"),
    )


class ThreadMute(Base):
    __tablename__ = "thread_mutes"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    muted_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    thread = relationship("Thread")
    user = relationship("User")

    __table_args__ = (UniqueConstraint("thread_id", "user_id", name="uq_thread_mutes_thread_user"),)


class ThreadJoinRequest(Base):
    __tablename__ = "thread_join_requests"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    responded_at = Column(DateTime, nullable=True)

    thread = relationship("Thread")
    requester = relationship("User")

    __table_args__ = (
        UniqueConstraint("thread_id", "requester_user_id", name="uq_thread_join_requests_thread_requester"),
        CheckConstraint("status IN ('pending', 'approved', 'declined')", name="ck_thread_join_requests_status"),
    )


class DMConversation(Base):
    __tablename__ = "dm_conversations"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    members = relationship("DMConversationMember", back_populates="conversation", cascade="all, delete-orphan")


class DMConversationMember(Base):
    __tablename__ = "dm_conversation_members"

    id = Column(Integer, primary_key=True, index=True)
    dm_conversation_id = Column(Integer, ForeignKey("dm_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    muted_at = Column(DateTime, nullable=True)
    last_read_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

    conversation = relationship("DMConversation", back_populates="members")
    user = relationship("User")

    __table_args__ = (UniqueConstraint("dm_conversation_id", "user_id", name="uq_dm_conversation_members_conversation_user"),)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id", ondelete="CASCADE"), nullable=True, index=True)
    dm_conversation_id = Column(Integer, ForeignKey("dm_conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reply_to_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True)
    type = Column(String(32), nullable=False, default="text", index=True)
    body = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    edited_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True, index=True)

    thread = relationship("Thread")
    dm_conversation = relationship("DMConversation")
    sender = relationship("User", foreign_keys=[sender_id])
    reply_to = relationship("Message", remote_side=[id])

    __table_args__ = (
        CheckConstraint("(thread_id IS NOT NULL) <> (dm_conversation_id IS NOT NULL)", name="ck_messages_one_conversation"),
        CheckConstraint(
            "type IN ('text', 'location', 'referral', 'workout_share', 'stack_share', 'system')",
            name="ck_messages_type",
        ),
    )


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


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(32), nullable=False, index=True)
    payload_json = Column("payload", JSONB, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    visibility = Column(String(16), nullable=False, default="friends", index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)

    user = relationship("User")
    reactions = relationship("FeedReaction", back_populates="event", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("type IN ('pr', 'streak_milestone', 'thread_joined')", name="ck_activity_events_type"),
        CheckConstraint("visibility IN ('friends', 'private')", name="ck_activity_events_visibility"),
    )


class FeedReaction(Base):
    __tablename__ = "feed_reactions"

    event_id = Column(Integer, ForeignKey("activity_events.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    type = Column(String(16), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    event = relationship("ActivityEvent", back_populates="reactions")
    user = relationship("User")

    __table_args__ = (CheckConstraint("type IN ('flame', 'clap')", name="ck_feed_reactions_type"),)


class Challenge(Base):
    __tablename__ = "challenges"

    id = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(32), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    target = Column(Integer, nullable=False)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)
    status = Column(String(16), nullable=False, default="active", index=True)
    winner_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    creator = relationship("User", foreign_keys=[creator_id])
    winner = relationship("User", foreign_keys=[winner_user_id])
    participants = relationship("ChallengeParticipant", back_populates="challenge", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("type IN ('streak_battle', 'workout_count')", name="ck_challenges_type"),
        CheckConstraint("status IN ('active', 'completed', 'cancelled')", name="ck_challenges_status"),
        CheckConstraint("target > 0", name="ck_challenges_target_positive"),
        CheckConstraint("end_date >= start_date", name="ck_challenges_date_order"),
    )


class ChallengeParticipant(Base):
    __tablename__ = "challenge_participants"

    challenge_id = Column(Integer, ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    progress = Column(Integer, nullable=False, default=0)
    joined_at = Column(DateTime, nullable=True)
    status = Column(String(16), nullable=False, default="invited", index=True)
    target_reached_at = Column(DateTime, nullable=True, index=True)

    challenge = relationship("Challenge", back_populates="participants")
    user = relationship("User")

    __table_args__ = (
        CheckConstraint("progress >= 0", name="ck_challenge_participants_progress_nonnegative"),
        CheckConstraint(
            "status IN ('invited', 'joined', 'declined', 'left')",
            name="ck_challenge_participants_status",
        ),
    )


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
    met_value = Column(Float, nullable=True, default=5.0)
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


class WorkoutSession(Base):
    """Guided active workout session (Elite). Upserted by client session_id."""

    __tablename__ = "workout_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plan_day_id = Column(String(64), nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(32), nullable=False)  # completed | abandoned
    server_kcal_total = Column(Float, nullable=False, default=0)
    streak_incremented = Column(Boolean, nullable=False, default=False)
    ai_tracking = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    set_logs = relationship("WorkoutSessionSetLog", back_populates="session", cascade="all, delete-orphan")


class WorkoutSessionSetLog(Base):
    __tablename__ = "workout_session_set_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_pk = Column(Integer, ForeignKey("workout_sessions.id"), nullable=False, index=True)
    exercise_name = Column(String(255), nullable=False)
    set_number = Column(Integer, nullable=False)
    reps = Column(Integer, nullable=False)
    weight_kg = Column(Float, nullable=True)
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=False)
    server_kcal = Column(Float, nullable=False, default=0)
    tracking_method = Column(String(32), nullable=False, default="manual")  # manual | ai_camera

    session = relationship("WorkoutSession", back_populates="set_logs")
