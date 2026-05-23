from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/fitnessdb"
    JWT_SECRET: str = "super-secret-key"
    # Same Web API key as Expo EXPO_PUBLIC_FIREBASE_API_KEY — used to verify ID tokens for password sync.
    FIREBASE_WEB_API_KEY: str = ""
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_TOKEN_CLOCK_SKEW_SECONDS: int = 60
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    FEEDBACK_TO_EMAIL: str = "admin@nexrep.in"
    FEEDBACK_SMTP_HOST: str = ""
    FEEDBACK_SMTP_PORT: int = 587
    FEEDBACK_SMTP_USERNAME: str = ""
    FEEDBACK_SMTP_PASSWORD: str = ""
    FEEDBACK_SMTP_USE_TLS: bool = True
    FEEDBACK_FROM_EMAIL: str = ""
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""
    USD_TO_INR_RATE: float = 83.5
    DEV_TOGGLE_SECRET: str = "nexrep-dev-toggle-2026"

    class Config:
        env_file = str(ENV_FILE)


settings = Settings()
