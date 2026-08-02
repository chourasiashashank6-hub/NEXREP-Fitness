import re
from datetime import datetime, timedelta

import bcrypt
from jose import jwt
from sqlalchemy.orm import Session

from src.core.config import settings
from src.models.models import User

_SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _is_legacy_sha256_hash(password_hash: str) -> bool:
    return bool(_SHA256_HEX_RE.match((password_hash or "").strip().lower()))


def verify_password(password: str, password_hash: str) -> bool:
    if _is_legacy_sha256_hash(password_hash):
        import hashlib

        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return legacy == password_hash.strip().lower()
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def migrate_sha256_to_bcrypt(db: Session) -> int:
    """
    Mark legacy SHA-256 password accounts for reset. Original passwords cannot be rehashed.
    """
    updated = 0
    users = db.query(User).all()
    for user in users:
        if not _is_legacy_sha256_hash(user.password_hash):
            continue
        if not getattr(user, "needs_password_reset", False):
            user.needs_password_reset = True
            updated += 1
    if updated:
        db.commit()
    return updated


def create_access_token(subject: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
