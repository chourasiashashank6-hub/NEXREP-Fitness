"""
Run once to seed the first admin account:
  python create_admin.py --email you@example.com --password yourpassword --name "Your Name"
"""

import argparse

from src.db.session import SessionLocal
import src.models.models  # noqa: F401 — register User for relationships
from src.models.admin_models import AdminUser
from src.utils.admin_auth import hash_password


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        existing = db.query(AdminUser).filter(AdminUser.email == args.email).first()
        if existing:
            print(f"Admin {args.email} already exists.")
            return

        admin = AdminUser(
            email=args.email,
            password_hash=hash_password(args.password),
            name=args.name,
            role="owner",
        )
        db.add(admin)
        db.commit()
        print(f"Admin created: {args.email} (role=owner)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
