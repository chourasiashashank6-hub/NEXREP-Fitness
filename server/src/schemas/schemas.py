from datetime import datetime
from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SyncPasswordRequest(BaseModel):
    """After Firebase password reset or when DB password is stale but Firebase sign-in works."""

    id_token: str
    new_password: str


class FirebaseLoginRequest(BaseModel):
    """Login using a Firebase ID token (client already authenticated with Firebase)."""

    id_token: str
    password: str
    name: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ActivityRequest(BaseModel):
    kind: str
    title: str
    calories: int | None = None
    duration: int | None = None
    intensity: str | None = None
    time: str | None = None


class WorkoutRequest(BaseModel):
    exercise_id: int | None = None
    type: str
    exerciseName: str
    sets: int | None = None
    reps: int | None = None
    duration: int | None = None
    difficulty: str | None = None
    metValue: float | None = None
    timeTaken: str | None = None
    notes: str | None = None


class WorkoutUpdateRequest(BaseModel):
    sets: int | None = None
    reps: int | None = None
    duration: int | None = None
    timeTaken: str | None = None


class StrengthLiftRequest(BaseModel):
    exercise_id: int | None = None
    exercise_name: str
    weight_kg: float
    reps: int
    workout_id: int | None = None


class StrengthLiftUpdateRequest(BaseModel):
    weight_kg: float
    reps: int


class MealRequest(BaseModel):
    name: str
    calories: int
    protein: int | None = None
    carbs: int | None = None
    fat: int | None = None


class ProfileRequest(BaseModel):
    name: str
    age: int
    weight: float
    goals: str
    goalTag: str
    difficulty: str


class LanguagePreferenceRequest(BaseModel):
    preferredLanguage: str | None = None


class ChatRequest(BaseModel):
    message: str
    context: dict | None = None


class OnboardingUpsertRequest(BaseModel):
    """Client sends full wizard state plus computed nutrition targets.

    Expected onboarding keys include:
    - dietary.meals_per_day (1-6)
    - dietary.regional_food_styles (optional list of regional cuisine preferences)
    - activity.workouts_per_week, activity.level, activity.workout_types
    - goal.type, goal.difficulty, goal.focus_muscles (optional array), goal.focus_muscle (legacy)
    """

    onboarding: dict
    targets: dict


class FeedbackRequest(BaseModel):
    subject: str
    body: str


class PushTokenRequest(BaseModel):
    expo_push_token: str
    platform: str
    device_id: str | None = None


class NotificationPreferencesRequest(BaseModel):
    preferences: dict


class WorkoutOut(BaseModel):
    id: int
    type: str
    exerciseName: str
    date: datetime

    class Config:
        from_attributes = True
