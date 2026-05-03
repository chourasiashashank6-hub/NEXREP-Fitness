from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/fitnessdb"
    JWT_SECRET: str = "super-secret-key"
    # Same Web API key as Expo EXPO_PUBLIC_FIREBASE_API_KEY — used to verify ID tokens for password sync.
    FIREBASE_WEB_API_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    class Config:
        env_file = ".env"


settings = Settings()
