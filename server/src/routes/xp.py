from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.models import User
from src.utils.auth import get_current_user
from src.services.xp_service import friends_season_leaderboard, serialize_xp_summary

router = APIRouter(prefix="/api/xp", tags=["xp"])


@router.get("/me")
def get_my_xp(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    payload = serialize_xp_summary(db, current_user.id)
    db.commit()
    return payload


@router.get("/leaderboard/friends")
def get_friends_xp_leaderboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = friends_season_leaderboard(db, current_user.id)
    db.commit()
    return {"items": items}
