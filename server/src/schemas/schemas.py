from datetime import datetime
from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
    type: str
    exerciseName: str
    sets: int | None = None
    reps: int | None = None
    duration: int | None = None
    difficulty: str | None = None
    metValue: float | None = None
    timeTaken: str | None = None
    notes: str | None = None


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


class ChatRequest(BaseModel):
    message: str
    context: dict | None = None


class OnboardingUpsertRequest(BaseModel):
    """Client sends full wizard state plus computed nutrition targets."""

    onboarding: dict
    targets: dict


class WorkoutOut(BaseModel):
    id: int
    type: str
    exerciseName: str
    date: datetime

    class Config:
        from_attributes = True
