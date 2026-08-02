import logging
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BASE_DIR / ".env"

_INSECURE_JWT_DEFAULTS = frozenset(
    {
        "your-secret-key",
        "super-secret-key",
        "change-me-to-a-long-random-secret",
    }
)


def normalize_database_url(url: str) -> str:
    """Render/Heroku provide postgres://; SQLAlchemy + psycopg needs postgresql+psycopg://."""
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        return "postgresql+psycopg://" + raw[len("postgres://") :]
    if raw.startswith("postgresql://"):
        return "postgresql+psycopg://" + raw[len("postgresql://") :]
    return raw


class Settings(BaseSettings):
    PORT: int = 8000
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/fitnessdb"
    JWT_SECRET: str = ""
    # Same Web API key as Expo EXPO_PUBLIC_FIREBASE_API_KEY — used to verify ID tokens for password sync.
    FIREBASE_WEB_API_KEY: str = ""
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_TOKEN_CLOCK_SKEW_SECONDS: int = 60
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    APP_ENV: str = "production"
    ALLOWED_ORIGINS: str = (
        "http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:8081,http://127.0.0.1:8081"
    )
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_API_KEY_FALLBACK: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    GOOGLE_PLACES_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GROQ_API_KEY_FALLBACK: str = ""
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
    # Comma-separated emails allowed to use /dev/subscription-toggle (development only)
    DEV_TIER_TOGGLE_EMAILS: str = "shashank1@gmail.com"
    DEV_TOGGLE_SECRET: str = "nexrep-dev-toggle-2026"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_database_url(value)
        return value

    class Config:
        env_file = str(ENV_FILE)


settings = Settings()


def validate_jwt_secret() -> None:
    secret = (settings.JWT_SECRET or "").strip()
    if secret in _INSECURE_JWT_DEFAULTS or len(secret) < 32:
        raise RuntimeError("Insecure JWT_SECRET")


def warn_missing_razorpay_webhook_secret() -> None:
    if not (settings.RAZORPAY_WEBHOOK_SECRET or "").strip():
        logger.warning("Razorpay webhook secret not set")
