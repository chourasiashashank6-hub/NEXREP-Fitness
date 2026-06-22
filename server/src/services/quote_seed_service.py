from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from src.db.session import SessionLocal
from src.models.models import MotivationalQuote

VALID_QUOTE_CATEGORIES = {"fat_loss", "muscle_gain", "strength", "general"}
VALID_NOTIFICATION_CONTEXTS = {"workout", "nutrition", "logging_nudge", "streak", "general"}
DEFAULT_QUOTES_SEED_PATH = Path(__file__).resolve().parents[2] / "seeds" / "quotes_seed.json"


def infer_notification_context(quote: str, category: str, explicit_context: str | None = None) -> str:
    context = str(explicit_context or "").strip().lower()
    if context in VALID_NOTIFICATION_CONTEXTS:
        return context

    text = f"{quote} {category}".lower()
    if any(word in text for word in ("meal", "nutrition", "calorie", "protein", "diet", "food", "eat")):
        return "nutrition"
    if any(word in text for word in ("habit", "repeated", "daily", "consistency", "consistent", "streak", "quit", "quitting")):
        return "streak"
    if any(word in text for word in ("log", "track", "record", "measure", "clock", "discipline")):
        return "logging_nudge"
    if category in {"strength", "muscle_gain"} or any(
        word in text for word in ("rep", "lift", "training", "workout", "muscle", "strength", "body", "gym")
    ):
        return "workout"
    if category == "fat_loss":
        return "nutrition"
    return "general"


def load_motivational_quotes_if_needed(engine: Engine, seed_path: Path | None = None) -> int:
    """Import motivational quote seed data. Safe to re-run; duplicate rows are skipped."""
    path = seed_path or DEFAULT_QUOTES_SEED_PATH
    if not path.exists():
        return 0

    with path.open("r", encoding="utf-8") as fh:
        rows = json.load(fh)
    if not isinstance(rows, list):
        raise ValueError("quotes_seed.json must contain a JSON array")

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE motivational_quotes ADD COLUMN IF NOT EXISTS notification_context VARCHAR(50) NOT NULL DEFAULT 'general'"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_motivational_quotes_notification_context ON motivational_quotes(notification_context)")
        )

    db: Session = SessionLocal(bind=engine)
    inserted = 0
    try:
        existing_rows = db.query(MotivationalQuote).all()
        existing = {(quote.quote.strip(), quote.author.strip(), quote.category) for quote in existing_rows}
        updated = 0
        for row in existing_rows:
            current_context = getattr(row, "notification_context", None)
            inferred = (
                current_context
                if current_context in VALID_NOTIFICATION_CONTEXTS and current_context != "general"
                else infer_notification_context(row.quote, row.category)
            )
            if row.notification_context != inferred:
                row.notification_context = inferred
                updated += 1
        to_add: list[MotivationalQuote] = []
        for idx, item in enumerate(rows, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"Quote row {idx} must be an object")
            quote = str(item.get("quote") or "").strip()
            author = str(item.get("author") or "").strip()
            category = str(item.get("category") or "").strip()
            notification_context = infer_notification_context(quote, category, item.get("notification_context"))
            if not quote or not author:
                raise ValueError(f"Quote row {idx} is missing quote or author")
            if category not in VALID_QUOTE_CATEGORIES:
                raise ValueError(f"Quote row {idx} has invalid category: {category}")
            key = (quote, author, category)
            if key in existing:
                continue
            existing.add(key)
            to_add.append(
                MotivationalQuote(
                    quote=quote,
                    author=author,
                    category=category,
                    notification_context=notification_context,
                    is_active=True,
                )
            )

        if to_add:
            db.add_all(to_add)
        if to_add or updated:
            db.commit()
            inserted = len(to_add)
        return inserted
    finally:
        db.close()
