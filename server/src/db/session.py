from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from src.core.config import settings

# AI endpoints hold the request for tens of seconds; keep enough connections so
# coach/refresh calls are not starved while a plan regenerate runs.
engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def release_db_connection(db: Session) -> None:
    """End the open transaction so the connection returns to the pool.

    Call this before long external I/O (Groq/Gemini). Leaving a transaction open
    during AI HTTP holds a pooled connection and can stall unrelated requests.
    """
    try:
        db.rollback()
    except Exception:
        pass
