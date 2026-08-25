#!/usr/bin/env python3
"""Migrate all users' current-month workout plans to engine v3 (future days only)."""

from __future__ import annotations

import argparse
import logging
from datetime import date

from src.db.session import SessionLocal
from src.models.models import User
from src.services.workout_engine_v3_bridge import migrate_user_current_month_v3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate workout plans to engine v3")
    parser.add_argument("--local-date", default=date.today().isoformat(), help="Reference local date YYYY-MM-DD")
    parser.add_argument("--user-id", type=int, default=None, help="Migrate a single user (dry-run friendly)")
    parser.add_argument("--dry-run", action="store_true", help="List users that would be migrated")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        q = db.query(User)
        if args.user_id:
            q = q.filter(User.id == args.user_id)
        users = q.all()
        migrated = 0
        for user in users:
            if args.dry_run:
                logger.info("Would migrate user_id=%s", user.id)
                continue
            if migrate_user_current_month_v3(db, user, local_date=args.local_date):
                migrated += 1
        logger.info("Migration complete: %s users migrated", migrated)
    finally:
        db.close()


if __name__ == "__main__":
    main()
