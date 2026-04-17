from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from src.core.config import settings
from src.db.session import get_db
from src.models.models import User

security = HTTPBearer()


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)
):
    token = creds.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        sub = payload.get("sub")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = db.query(User).filter(User.id == int(sub)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
