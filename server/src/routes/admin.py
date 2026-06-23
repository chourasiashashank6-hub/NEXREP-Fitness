from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.admin_models import AdminUser, AiUsageLog, Subscription, UserActivityLog
from src.models.models import User, UserReport
from src.utils.admin_auth import (
    create_admin_token,
    get_current_admin,
    hash_password,
    require_owner,
    verify_password,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class CreateAdminRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "analyst"


@router.post("/auth/login")
def admin_login(body: AdminLoginRequest, db: Session = Depends(get_db)):
    admin = (
        db.query(AdminUser)
        .filter(AdminUser.email == str(body.email).strip().lower(), AdminUser.is_active.is_(True))
        .first()
    )
    if not admin or not verify_password(body.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    admin.last_login_at = datetime.utcnow()
    db.commit()
    token = create_admin_token(admin.id, admin.role)
    return {"access_token": token, "token_type": "bearer", "role": admin.role, "name": admin.name}


@router.get("/auth/me")
def admin_me(admin: AdminUser = Depends(get_current_admin)):
    return {"id": admin.id, "email": admin.email, "name": admin.name, "role": admin.role}


@router.get("/overview")
def overview(db: Session = Depends(get_db), admin: AdminUser = Depends(get_current_admin)):
    _ = admin
    total_users = db.query(func.count(User.id)).scalar() or 0
    free_users = db.query(func.count(User.id)).filter(User.plan_id == "free").scalar() or 0
    pro_users = db.query(func.count(User.id)).filter(User.plan_id == "pro").scalar() or 0
    elite_users = db.query(func.count(User.id)).filter(User.plan_id == "elite").scalar() or 0

    total_revenue = (
        db.query(func.sum(Subscription.price_inr))
        .filter(
            Subscription.status == "active",
            Subscription.billing_cycle.notin_(["trial"]),
        )
        .scalar()
        or 0
    )

    monthly_subs = (
        db.query(func.sum(Subscription.price_inr))
        .filter(Subscription.status == "active", Subscription.billing_cycle == "monthly")
        .scalar()
        or 0
    )
    yearly_subs = (
        db.query(func.sum(Subscription.price_inr))
        .filter(Subscription.status == "active", Subscription.billing_cycle == "yearly")
        .scalar()
        or 0
    )
    mrr = float(monthly_subs) + float(yearly_subs) / 12

    this_month_start = date.today().replace(day=1)
    ai_cost_month = (
        db.query(func.sum(AiUsageLog.cost_inr)).filter(AiUsageLog.created_at >= this_month_start).scalar() or 0
    )

    new_today = db.query(func.count(User.id)).filter(func.date(User.created_at) == date.today()).scalar() or 0

    dau = (
        db.query(func.count(UserActivityLog.user_id))
        .filter(UserActivityLog.event_date == date.today())
        .scalar()
        or 0
    )

    mau = (
        db.query(func.count(func.distinct(UserActivityLog.user_id)))
        .filter(UserActivityLog.event_date >= this_month_start)
        .scalar()
        or 0
    )

    return {
        "total_users": total_users,
        "free_users": free_users,
        "pro_users": pro_users,
        "elite_users": elite_users,
        "total_revenue_inr": float(total_revenue),
        "mrr_inr": float(mrr),
        "ai_cost_month_inr": float(ai_cost_month),
        "new_users_today": new_today,
        "dau": dau,
        "mau": mau,
    }


@router.get("/reports")
def list_user_reports(
    status: Optional[str] = Query(default=None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    query = (
        db.query(UserReport, User.name.label("reporter_name"), User.email.label("reporter_email"))
        .join(User, User.id == UserReport.reporter_id)
    )
    if status:
        query = query.filter(UserReport.status == status)
    total = query.count()
    rows = query.order_by(UserReport.created_at.desc()).offset(offset).limit(limit).all()
    reported_ids = [report.reported_user_id for report, _reporter_name, _reporter_email in rows]
    reported_users = db.query(User).filter(User.id.in_(reported_ids or [-1])).all()
    reported_by_id = {user.id: user for user in reported_users}
    return {
        "total": total,
        "items": [
            {
                "id": report.id,
                "reporter": {
                    "user_id": report.reporter_id,
                    "name": reporter_name,
                    "email": reporter_email,
                },
                "reported_user": {
                    "user_id": report.reported_user_id,
                    "name": reported_by_id.get(report.reported_user_id).name if report.reported_user_id in reported_by_id else None,
                    "email": reported_by_id.get(report.reported_user_id).email if report.reported_user_id in reported_by_id else None,
                },
                "reason": report.reason,
                "context": report.context,
                "reference_id": report.reference_id,
                "details": report.details,
                "created_at": report.created_at.isoformat() if report.created_at else None,
                "status": report.status,
            }
            for report, reporter_name, reporter_email in rows
        ],
    }


@router.get("/users/growth")
def user_growth(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    since = date.today() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT DATE(created_at) AS signup_date, COUNT(*) AS count
        FROM users
        WHERE created_at >= :since
        GROUP BY DATE(created_at)
        ORDER BY signup_date
        """
        ),
        {"since": since},
    ).fetchall()
    return [{"date": str(r.signup_date), "new_users": r.count} for r in rows]


@router.get("/subscriptions/summary")
def subscriptions_summary(db: Session = Depends(get_db), admin: AdminUser = Depends(get_current_admin)):
    _ = admin
    rows = db.execute(
        text(
            """
        SELECT plan_id, billing_cycle, status, COUNT(*) AS count,
               SUM(price_inr) AS revenue
        FROM subscriptions
        GROUP BY plan_id, billing_cycle, status
        ORDER BY plan_id, billing_cycle
        """
        )
    ).fetchall()
    return [
        {
            "plan_id": r.plan_id,
            "billing_cycle": r.billing_cycle,
            "status": r.status,
            "count": r.count,
            "revenue_inr": float(r.revenue or 0),
        }
        for r in rows
    ]


@router.get("/subscriptions/history")
def subscription_history(
    plan_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    q = db.query(Subscription, User.email, User.name).join(User, Subscription.user_id == User.id)
    if plan_id:
        q = q.filter(Subscription.plan_id == plan_id)
    if status:
        q = q.filter(Subscription.status == status)
    total = q.count()
    rows = q.order_by(Subscription.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": s.id,
                "user_email": email,
                "user_name": name,
                "plan_id": s.plan_id,
                "billing_cycle": s.billing_cycle,
                "status": s.status,
                "price_inr": float(s.price_inr or 0),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            }
            for s, email, name in rows
        ],
    }


@router.get("/revenue/monthly")
def revenue_monthly(
    months: int = Query(12, ge=1, le=24),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    rows = db.execute(
        text(
            """
        SELECT
            DATE_TRUNC('month', started_at) AS month,
            SUM(price_inr) AS revenue,
            COUNT(*) AS subscriptions
        FROM subscriptions
        WHERE status IN ('active', 'cancelled', 'expired')
          AND billing_cycle != 'trial'
          AND started_at >= NOW() - CAST(:months AS INTEGER) * INTERVAL '1 month'
        GROUP BY month
        ORDER BY month
        """
        ),
        {"months": months},
    ).fetchall()
    return [
        {"month": str(r.month)[:7], "revenue_inr": float(r.revenue or 0), "subscriptions": r.subscriptions}
        for r in rows
    ]


@router.get("/ai/summary")
def ai_summary(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT feature, provider, model,
               SUM(prompt_tokens) AS prompt_tokens,
               SUM(completion_tokens) AS completion_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(cost_inr) AS cost_inr,
               COUNT(*) AS calls,
               SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_calls,
               SUM(CASE WHEN is_fallback THEN 1 ELSE 0 END) AS fallback_calls
        FROM ai_usage_logs
        WHERE created_at >= :since
        GROUP BY feature, provider, model
        ORDER BY cost_inr DESC
        """
        ),
        {"since": since},
    ).fetchall()

    total_cost = sum(float(r.cost_inr or 0) for r in rows)
    total_tokens = sum(int(r.total_tokens or 0) for r in rows)

    return {
        "period_days": days,
        "total_cost_inr": total_cost,
        "total_tokens": total_tokens,
        "by_feature": [
            {
                "feature": r.feature,
                "provider": r.provider,
                "model": r.model,
                "prompt_tokens": int(r.prompt_tokens or 0),
                "completion_tokens": int(r.completion_tokens or 0),
                "total_tokens": int(r.total_tokens or 0),
                "cost_inr": float(r.cost_inr or 0),
                "calls": r.calls,
                "successful_calls": r.successful_calls,
                "fallback_calls": r.fallback_calls,
            }
            for r in rows
        ],
    }


@router.get("/ai/daily")
def ai_daily(
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
):
    _ = admin
    since = date.today() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT DATE(created_at) AS day,
               SUM(total_tokens) AS tokens,
               SUM(cost_inr) AS cost_inr,
               COUNT(*) AS calls
        FROM ai_usage_logs
        WHERE created_at >= :since
        GROUP BY DATE(created_at)
        ORDER BY day
        """
        ),
        {"since": since},
    ).fetchall()
    return [
        {"date": str(r.day), "tokens": int(r.tokens or 0), "cost_inr": float(r.cost_inr or 0), "calls": r.calls}
        for r in rows
    ]


@router.get("/ai/top-users")
def ai_top_users(
    days: int = Query(30, ge=1, le=90),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT a.user_id, u.email, u.name, u.plan_id,
               SUM(a.total_tokens) AS tokens,
               SUM(a.cost_inr) AS cost_inr,
               COUNT(*) AS calls
        FROM ai_usage_logs a
        JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= :since
        GROUP BY a.user_id, u.email, u.name, u.plan_id
        ORDER BY cost_inr DESC
        LIMIT :limit
        """
        ),
        {"since": since, "limit": limit},
    ).fetchall()
    return [
        {
            "user_id": r.user_id,
            "email": r.email,
            "name": r.name,
            "plan_id": r.plan_id,
            "total_tokens": int(r.tokens or 0),
            "cost_inr": float(r.cost_inr or 0),
            "calls": r.calls,
        }
        for r in rows
    ]


@router.get("/ai/user/{user_id}")
def ai_user_history(
    user_id: int,
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    _ = admin
    since = date.today() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT DATE(created_at) AS day,
               feature,
               SUM(total_tokens) AS tokens,
               SUM(cost_inr) AS cost_inr,
               COUNT(*) AS calls
        FROM ai_usage_logs
        WHERE user_id = :uid AND created_at >= :since
        GROUP BY DATE(created_at), feature
        ORDER BY day DESC, cost_inr DESC
        """
        ),
        {"uid": user_id, "since": since},
    ).fetchall()

    user = db.query(User).filter(User.id == user_id).first()
    return {
        "user": {"id": user_id, "email": user.email if user else None, "plan_id": user.plan_id if user else None},
        "history": [
            {
                "date": str(r.day),
                "feature": r.feature,
                "tokens": int(r.tokens or 0),
                "cost_inr": float(r.cost_inr or 0),
                "calls": r.calls,
            }
            for r in rows
        ],
    }


@router.get("/users")
def list_users(
    search: Optional[str] = None,
    plan_id: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    _ = admin
    q = db.query(User)
    if search:
        q = q.filter((User.email.ilike(f"%{search}%")) | (User.name.ilike(f"%{search}%")))
    if plan_id:
        q = q.filter(User.plan_id == plan_id)
    total = q.count()
    users = q.order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "plan_id": getattr(u, "plan_id", "free") or "free",
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None,
                "plan_expires_at": u.plan_expires_at.isoformat() if u.plan_expires_at else None,
            }
            for u in users
        ],
    }


@router.get("/users/{user_id}/detail")
def user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    subs = (
        db.query(Subscription)
        .filter(Subscription.user_id == user_id)
        .order_by(Subscription.created_at.desc())
        .all()
    )

    ai_totals = db.execute(
        text(
            """
        SELECT SUM(total_tokens) AS tokens, SUM(cost_inr) AS cost_inr
        FROM ai_usage_logs WHERE user_id = :uid
        """
        ),
        {"uid": user_id},
    ).fetchone()

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "plan_id": getattr(user, "plan_id", "free") or "free",
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
            "age": user.age,
            "weight": user.weight,
            "goal_tag": user.goal_tag,
        },
        "subscriptions": [
            {
                "plan_id": s.plan_id,
                "billing_cycle": s.billing_cycle,
                "status": s.status,
                "price_inr": float(s.price_inr or 0),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            }
            for s in subs
        ],
        "ai_usage_total": {
            "total_tokens": int(ai_totals.tokens or 0),
            "total_cost_inr": float(ai_totals.cost_inr or 0),
        },
    }


@router.post("/admins")
def create_admin(
    body: CreateAdminRequest,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    _ = admin
    email = str(body.email).strip().lower()
    if db.query(AdminUser).filter(AdminUser.email == email).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    new_admin = AdminUser(
        email=email,
        password_hash=hash_password(body.password),
        name=body.name,
        role=body.role,
    )
    db.add(new_admin)
    db.commit()
    return {"id": new_admin.id, "email": new_admin.email, "role": new_admin.role}


@router.get("/admins")
def list_admins(db: Session = Depends(get_db), admin: AdminUser = Depends(require_owner)):
    _ = admin
    admins = db.query(AdminUser).all()
    return [
        {
            "id": a.id,
            "email": a.email,
            "name": a.name,
            "role": a.role,
            "is_active": a.is_active,
            "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
        }
        for a in admins
    ]


@router.get("/ai/cost-alerts")
def cost_alerts(
    threshold_inr: float = Query(500.0),
    days: int = Query(7),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_owner),
):
    _ = admin
    since = datetime.utcnow() - timedelta(days=days)
    rows = db.execute(
        text(
            """
        SELECT a.user_id, u.email, u.name, u.plan_id,
               SUM(a.cost_inr) AS cost_inr, SUM(a.total_tokens) AS tokens
        FROM ai_usage_logs a
        JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= :since
        GROUP BY a.user_id, u.email, u.name, u.plan_id
        HAVING SUM(a.cost_inr) > :threshold
        ORDER BY cost_inr DESC
        """
        ),
        {"since": since, "threshold": threshold_inr},
    ).fetchall()
    return [
        {
            "user_id": r.user_id,
            "email": r.email,
            "name": r.name,
            "plan_id": r.plan_id,
            "cost_inr": float(r.cost_inr),
            "tokens": int(r.tokens or 0),
        }
        for r in rows
    ]
