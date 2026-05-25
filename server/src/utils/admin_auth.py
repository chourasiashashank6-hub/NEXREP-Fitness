from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session

from src.core.config import settings
from src.db.session import get_db
from src.models.admin_models import AdminUser

ADMIN_JWT_ALGORITHM = "HS256"
ADMIN_TOKEN_EXPIRE_HOURS = 12
ADMIN_SECRET_SUFFIX = "_ADMIN_SALT_v1"

bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_admin_token(admin_id: int, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ADMIN_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(admin_id),
        "role": role,
        "exp": int(expire.timestamp()),
        "type": "admin",
    }
    secret = settings.JWT_SECRET + ADMIN_SECRET_SUFFIX
    return jwt.encode(payload, secret, algorithm=ADMIN_JWT_ALGORITHM)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AdminUser:
    token = credentials.credentials
    secret = settings.JWT_SECRET + ADMIN_SECRET_SUFFIX
    try:
        payload = jwt.decode(token, secret, algorithms=[ADMIN_JWT_ALGORITHM])
        if payload.get("type") != "admin":
            raise HTTPException(status_code=401, detail="Not an admin token")
        admin_id = int(payload["sub"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid admin token") from exc
    admin = db.query(AdminUser).filter(AdminUser.id == admin_id, AdminUser.is_active.is_(True)).first()
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin


def require_owner(admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
    if admin.role != "owner":
        raise HTTPException(status_code=403, detail="Owner role required")
    return admin
