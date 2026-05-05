from datetime import datetime, timedelta
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from sqlalchemy import func, text
from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from src.db.session import Base, engine, get_db
from src.core.config import settings
from src.models.models import Activity, Meal, User, UserOnboarding, Workout, WorkoutCatalog
from src.models.nutrition_calories import AIFoodMealEntry, DailyNutritionLog, MealEntry, WaterIntakeLog  # noqa: F401
from src.schemas.schemas import (
    ActivityRequest,
    ChatRequest,
    LoginRequest,
    MealRequest,
    OnboardingUpsertRequest,
    ProfileRequest,
    SignupRequest,
    SyncPasswordRequest,
    WorkoutRequest,
    WorkoutUpdateRequest,
)
from src.services.auth_service import create_access_token, hash_password, verify_password
from src.services.firebase_token import email_from_firebase_id_token
from src.services.food_catalog_service import ensure_food_catalog_schema, load_food_catalog_from_sql_if_empty
from src.services.score_service import compute_discipline_score
from src.utils.auth import get_current_user
from src.routes.calories import router as calories_api_router

app = FastAPI(title="Fitness API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calories_api_router, prefix="/api/calories")
# Alternate prefix so clients can discover working routes if /api/* is blocked or an old binary omits the first mount.
app.include_router(calories_api_router, prefix="/v1/calories")


@app.get("/health")
def health():
    """Lightweight check that the API process is up (use before login from the app)."""
    return {"status": "ok"}


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    apply_schema_updates()
    ensure_food_catalog_schema(engine)
    load_food_catalog_from_sql_if_empty(engine)


def apply_schema_updates() -> None:
    """
    Lightweight schema patches for local environments without migrations.
    """
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_tag VARCHAR(128) DEFAULT 'Fat Loss'"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS difficulty VARCHAR(64) DEFAULT 'Beginner'"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()"))
        conn.execute(
            text(
                """
                UPDATE users u
                SET created_at = COALESCE(
                    (SELECT MIN(w.date) FROM workouts w WHERE w.user_id = u.id),
                    (SELECT MIN(m.date) FROM meals m WHERE m.user_id = u.id),
                    (SELECT MIN(a.created_at) FROM activities a WHERE a.user_id = u.id),
                    u.created_at,
                    NOW()
                )
                WHERE
                    u.created_at IS NULL
                    OR u.created_at > COALESCE(
                        (SELECT MIN(w.date) FROM workouts w WHERE w.user_id = u.id),
                        (SELECT MIN(m.date) FROM meals m WHERE m.user_id = u.id),
                        (SELECT MIN(a.created_at) FROM activities a WHERE a.user_id = u.id),
                        u.created_at
                    )
                """
            )
        )
        conn.execute(text("ALTER TABLE daily_nutrition_logs ADD COLUMN IF NOT EXISTS total_fiber_g NUMERIC(6,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE daily_nutrition_logs ADD COLUMN IF NOT EXISTS target_fiber_g NUMERIC(6,2) DEFAULT 30"))
        conn.execute(text("ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS fiber_per_100g NUMERIC(6,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS total_fiber_g NUMERIC(6,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS source_type VARCHAR(24) DEFAULT 'database'"))
        conn.execute(text("ALTER TABLE ai_food_meal_entries ADD COLUMN IF NOT EXISTS log_date DATE"))
        conn.execute(text("UPDATE ai_food_meal_entries SET log_date = COALESCE(log_date, DATE(created_at), CURRENT_DATE)"))
        conn.execute(text("ALTER TABLE ai_food_meal_entries ALTER COLUMN log_date SET NOT NULL"))
        conn.execute(text("ALTER TABLE IF EXISTS user_calorie_targets ADD COLUMN IF NOT EXISTS target_fiber_g NUMERIC(6,2) DEFAULT 30"))


def estimate_workout_calories(payload: WorkoutRequest) -> int:
    """
    Estimate calories burned from workout input.
    Falls back to volume-based effort when duration is missing.
    """
    type_rate_per_minute = {"hiit": 10.0, "compound": 7.0, "stability": 4.0}
    workout_type = (payload.type or "").lower()

    if payload.duration and payload.duration > 0:
        rate = type_rate_per_minute.get(workout_type, 5.0)
        return max(1, int(round(payload.duration * rate)))

    total_reps = (payload.sets or 0) * (payload.reps or 0)
    if total_reps > 0:
        # Rough conversion from rep volume to kcal when duration is not provided.
        return max(1, int(round(total_reps * 0.35)))

    # Minimum non-zero burn so dashboard always reflects logged effort.
    return 15


def parse_time_taken_to_hours(time_taken: str | None) -> float | None:
    if not time_taken:
        return None
    try:
        minute_part, second_part = time_taken.split(":")
        minutes = int(minute_part)
        seconds = int(second_part)
    except (ValueError, AttributeError):
        return None
    if minutes < 0 or seconds < 0 or seconds > 59:
        return None
    return (minutes * 60 + seconds) / 3600


def met_from_difficulty_and_volume(difficulty: str | None, sets: int | None, reps: int | None) -> float:
    difficulty_key = (difficulty or "").strip().lower()
    base_met_map = {"beginner": 3.5, "intermediate": 5.5, "advanced": 7.5}
    base_met = base_met_map.get(difficulty_key, 4.5)
    volume = max(0, (sets or 0) * (reps or 0))
    volume_bonus = min(2.0, volume / 120)
    return base_met + volume_bonus


def estimate_workout_calories_via_met(payload: WorkoutRequest, body_weight_kg: float) -> int:
    parsed_time_in_hours = parse_time_taken_to_hours(payload.timeTaken)
    met_value = payload.metValue if payload.metValue and payload.metValue > 0 else met_from_difficulty_and_volume(payload.difficulty, payload.sets, payload.reps)

    # Explicit influence from both sets and reps independently so changes are
    # visible even when total volume is similar.
    sets = max(1, int(payload.sets or 1))
    reps = max(1, int(payload.reps or 1))
    volume = sets * reps

    # Approximate training time from volume:
    # ~2.2 sec per rep + ~45 sec rest between sets.
    active_seconds = sets * reps * 2.2
    rest_seconds = max(0, sets - 1) * 45
    expected_seconds = max(60, int(round(active_seconds + rest_seconds)))
    expected_time_hours = expected_seconds / 3600.0

    # Keep MET baseline tied to expected workload time so longer logged time
    # does not artificially increase calories for identical volume.
    base_calories = met_value * body_weight_kg * expected_time_hours

    # Baseline around common template 3 sets x 12 reps.
    baseline_sets = 3
    baseline_reps = 12

    # Independent multipliers:
    # - more sets => more total work/rest overhead and session strain
    # - higher reps => longer time-under-tension per set
    set_multiplier = 1.0 + ((sets - baseline_sets) * 0.09)
    rep_multiplier = 1.0 + ((reps - baseline_reps) * 0.025)
    set_multiplier = max(0.65, min(2.0, set_multiplier))
    rep_multiplier = max(0.70, min(1.8, rep_multiplier))

    # Additional explicit volume calories so integer rounding does not hide
    # differences in nearby inputs.
    volume_bonus_kcal = max(0, volume - (baseline_sets * baseline_reps)) * 0.8

    pace_multiplier = 1.0
    if parsed_time_in_hours is not None and parsed_time_in_hours > 0:
        actual_seconds = max(1, int(round(parsed_time_in_hours * 3600)))
        pace_ratio = expected_seconds / actual_seconds
        pace_multiplier = max(0.75, min(1.40, pace_ratio ** 0.6))

    calories = (base_calories * set_multiplier * rep_multiplier * pace_multiplier) + volume_bonus_kcal
    return max(1, int(round(calories)))


def normalize_optional_filter(value: str | None) -> str | None:
    """
    Treat UI placeholders/default labels as an unselected value.
    """
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered in {"select choice", "select_choice", "default", "no choice", "no_choice", "none"}:
        return None
    return cleaned


def _parse_body_part_from_notes(notes: str | None) -> str | None:
    if not notes:
        return None
    marker = "body_part="
    idx = notes.lower().find(marker)
    if idx < 0:
        return None
    raw = notes[idx + len(marker):].split(";")[0].strip()
    return raw or None


def _parse_value_from_notes(notes: str | None, key: str) -> str | None:
    if not notes or not key:
        return None
    marker = f"{key}="
    idx = notes.lower().find(marker.lower())
    if idx < 0:
        return None
    raw = notes[idx + len(marker):].split(";")[0].strip()
    return raw or None


def _estimate_saved_workout_calories(
    workout: Workout,
    user_weight_kg: float,
    db: Session,
    override_time_taken: str | None = None,
) -> int:
    catalog_row = (
        db.query(WorkoutCatalog)
        .filter(func.lower(WorkoutCatalog.exercise_name) == (workout.exercise_name or "").strip().lower())
        .first()
    )
    derived_difficulty = (
        catalog_row.difficulty
        if catalog_row and catalog_row.difficulty
        else _parse_value_from_notes(workout.notes, "difficulty")
    )
    derived_met = (
        float(catalog_row.met_value)
        if catalog_row and catalog_row.met_value is not None and catalog_row.met_value > 0
        else None
    )
    effective_time_taken = override_time_taken or (f"{int(workout.duration)}:00" if workout.duration else None)
    return estimate_workout_calories_via_met(
        WorkoutRequest(
            type=workout.type,
            exerciseName=workout.exercise_name,
            sets=workout.sets,
            reps=workout.reps,
            duration=workout.duration,
            difficulty=derived_difficulty,
            metValue=derived_met,
            timeTaken=effective_time_taken,
        ),
        user_weight_kg or 70,
    )


def _muscles_from_body_part(body_part: str | None) -> list[str]:
    if not body_part:
        return []
    lowered = body_part.strip().lower()
    out: list[str] = []
    if "chest" in lowered:
        out.append("Chest")
    if "shoulder" in lowered:
        out.append("Shoulders")
    if "tricep" in lowered:
        out.append("Triceps")
    if "back" in lowered:
        out.append("Back")
    if "leg" in lowered or "quad" in lowered or "hamstring" in lowered or "glute" in lowered:
        out.append("Legs")
    if "bicep" in lowered or "arm" in lowered:
        out.append("Biceps")
    # Deduplicate while preserving order.
    return [m for i, m in enumerate(out) if m not in out[:i]]


def _infer_muscles_from_workout(workout: Workout, db: Session) -> list[str]:
    # 1) Most reliable source: workout catalog body_part for the exact exercise.
    catalog_row = (
        db.query(WorkoutCatalog)
        .filter(func.lower(WorkoutCatalog.exercise_name) == (workout.exercise_name or "").strip().lower())
        .first()
    )
    mapped = _muscles_from_body_part(catalog_row.body_part if catalog_row else None)
    if mapped:
        return mapped

    # 2) Explicit body_part encoded in notes by workout logger.
    from_notes = _parse_body_part_from_notes(workout.notes)
    mapped = _muscles_from_body_part(from_notes)
    if mapped:
        return mapped

    # 3) Unknown mapping: return empty so we don't fabricate muscle load.
    return []


def _relative_label(dt: datetime | None) -> str:
    if not dt:
        return "Not trained recently"
    diff_hours = max(0, int((datetime.utcnow() - dt).total_seconds() // 3600))
    if diff_hours < 24:
        return "Today"
    days = max(1, round(diff_hours / 24))
    if days == 1:
        return "Yesterday"
    return f"{days} days ago"


def _groq_workout_coach(payload: dict) -> dict:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY missing on server")

    system_prompt = (
        "You are an expert workout and recovery coach. "
        "Return ONLY valid JSON with exact keys: insightText, readinessScore, readinessLabel, readinessDescription, readinessFactors. "
        "readinessScore must be 0-100 integer. "
        "readinessFactors must be exactly 3 items with keys label and type where type in [good, warning, bad, info]. "
        "Insight should be concise (2-4 sentences), practical, and mention which muscles to prioritize or avoid today."
    )

    req = Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(
            {
                "model": settings.GROQ_MODEL or "llama-3.3-70b-versatile",
                "temperature": 0.3,
                "max_tokens": 420,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(payload)},
                ],
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Accept": "application/json",
            "User-Agent": "fitness-workout-coach/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Groq HTTP {e.code}: {body[:260]}") from e
    except URLError as e:
        raise RuntimeError(f"Groq network error: {e.reason}") from e

    content = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("Groq returned empty workout insight")
    clean = content.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(clean)
    if not isinstance(parsed, dict):
        raise RuntimeError("Groq returned invalid workout JSON")
    return parsed


def build_recommendation(row: WorkoutCatalog) -> str:
    sets = row.sets_recommended or "-"
    reps = row.reps_recommended or "-"
    rest = row.rest_time_sec if row.rest_time_sec is not None else "-"
    return f"{sets} sets x {reps} reps, rest {rest}s"


def apply_onboarding_personal_to_user(user: User, onboarding: dict) -> None:
    """Keep core User profile loosely aligned with onboarding personal data."""
    personal = onboarding.get("personal") or {}
    name = personal.get("name")
    if isinstance(name, str) and name.strip():
        user.name = name.strip()[:120]
    if personal.get("age") is not None:
        try:
            user.age = int(personal["age"])
        except (TypeError, ValueError):
            pass
    try:
        if personal.get("unit_system") == "imperial" and personal.get("weight_lb") is not None:
            user.weight = float(personal["weight_lb"]) * 0.45359237
        elif personal.get("weight_kg") is not None:
            user.weight = float(personal["weight_kg"])
    except (TypeError, ValueError):
        pass

    goal_type_labels = {
        "fat_loss": "Fat Loss",
        "muscle_gain": "Muscle Gain",
        "strength": "Strength",
        "recomp": "Recomp",
        "maintain": "Maintain",
    }

    # Sync profile goal_tag with onboarding primary goal.
    goal_candidates = [
        goal_type_labels.get((onboarding.get("goal") or {}).get("type"))
        if isinstance(onboarding.get("goal"), dict)
        else None,
        onboarding.get("primary_goal"),
        onboarding.get("primaryGoal"),
        onboarding.get("goal_tag"),
        onboarding.get("goalTag"),
    ]
    goals_section = onboarding.get("goals") if isinstance(onboarding.get("goals"), dict) else {}
    goal_candidates.extend(
        [
            goals_section.get("primary_goal"),
            goals_section.get("primaryGoal"),
            goals_section.get("goal_tag"),
            goals_section.get("goalTag"),
            goals_section.get("goal"),
            goals_section.get("selectedGoal"),
        ]
    )
    for goal in goal_candidates:
        if isinstance(goal, str) and goal.strip():
            user.goal_tag = goal.strip()[:128]
            break

    # Keep profile free-text goals aligned with primary goal from onboarding.
    if user.goal_tag:
        user.goals = user.goal_tag

    # Sync profile difficulty from onboarding choices.
    goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
    activity = onboarding.get("activity") if isinstance(onboarding.get("activity"), dict) else {}
    goal_pace = (goal.get("pace") or "").strip().lower() if isinstance(goal.get("pace"), str) else ""
    activity_level = (activity.get("level") or "").strip().lower() if isinstance(activity.get("level"), str) else ""
    workouts_per_week = activity.get("workouts_per_week")

    if goal_pace == "aggressive" or activity_level in {"very_active", "extremely_active"}:
        user.difficulty = "Advanced"
    elif (
        goal_pace == "moderate"
        or activity_level == "moderately_active"
        or (isinstance(workouts_per_week, (int, float)) and workouts_per_week >= 4)
    ):
        user.difficulty = "Intermediate"
    elif goal_pace == "slow" or activity_level in {"sedentary", "lightly_active"}:
        user.difficulty = "Beginner"


@app.post("/signup")
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer"}


@app.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer"}


@app.post("/auth/sync-password")
def sync_password_after_firebase(payload: SyncPasswordRequest, db: Session = Depends(get_db)):
    """Update stored password to match Firebase after reset or first-time alignment."""
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    email = email_from_firebase_id_token(payload.id_token.strip())
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No fitness account for this email. Sign up first.")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    db.refresh(user)
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer"}


@app.get("/onboarding/me")
def get_my_onboarding(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return {"onboarding": row.onboarding_json, "targets": row.targets_json}


@app.put("/onboarding/me")
def put_my_onboarding(
    payload: OnboardingUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not isinstance(payload.onboarding, dict) or not isinstance(payload.targets, dict):
        raise HTTPException(status_code=422, detail="Invalid payload")
    apply_onboarding_personal_to_user(current_user, payload.onboarding)
    row = db.query(UserOnboarding).filter(UserOnboarding.user_id == current_user.id).first()
    if row:
        row.onboarding_json = payload.onboarding
        row.targets_json = payload.targets
    else:
        row = UserOnboarding(
            user_id=current_user.id,
            onboarding_json=payload.onboarding,
            targets_json=payload.targets,
        )
        db.add(row)
    db.add(current_user)
    db.commit()
    db.refresh(row)
    return {"onboarding": row.onboarding_json, "targets": row.targets_json}


@app.get("/summary")
def summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    meals = db.query(Meal).filter(Meal.user_id == current_user.id).all()
    workouts = db.query(Workout).filter(Workout.user_id == current_user.id).all()
    exercise_activities = (
        db.query(Activity)
        .filter(Activity.user_id == current_user.id, Activity.kind == "exercise")
        .all()
    )
    activity = (
        db.query(Activity)
        .filter(Activity.user_id == current_user.id)
        .order_by(Activity.created_at.desc())
        .limit(10)
        .all()
    )

    score = compute_discipline_score(len(workouts), len(meals), len(activity))
    calories_from_activities = sum((a.calories or 0) for a in exercise_activities)

    # Fallback safety: derive burn from workouts so Home always reflects saved workouts.
    calories_from_workouts = 0
    for workout in workouts:
        synthetic_payload = WorkoutRequest(
            type=workout.type,
            exerciseName=workout.exercise_name,
            sets=workout.sets,
            reps=workout.reps,
            duration=workout.duration,
        )
        calories_from_workouts += estimate_workout_calories(synthetic_payload)

    return {
        "caloriesConsumed": sum(m.calories for m in meals),
        "caloriesBurned": max(calories_from_activities, calories_from_workouts),
        "workoutSummary": workouts[-1].exercise_name if workouts else "No workout yet",
        "disciplineScore": score,
        "recentActivity": [
            {"id": a.id, "title": f"{a.kind}: {a.title}", "createdAt": a.created_at.isoformat()}
            for a in activity
        ],
    }


@app.post("/activity")
def add_activity(
    payload: ActivityRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    calories = payload.calories
    if payload.kind == "exercise" and calories is None and payload.duration:
        calories = max(1, int(round(payload.duration * 5)))

    item = Activity(
        user_id=current_user.id,
        kind=payload.kind,
        title=payload.title,
        calories=calories,
        duration=payload.duration,
        intensity=payload.intensity,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id}


@app.post("/workout/estimate")
def estimate_workout_calories_endpoint(
    payload: WorkoutRequest,
    current_user: User = Depends(get_current_user),
):
    """Same MET-based model as POST /workout, without persisting — for UI previews."""
    return {
        "estimatedCalories": estimate_workout_calories_via_met(
            payload,
            float(current_user.weight or 70),
        ),
    }


@app.post("/workout")
def add_workout(
    payload: WorkoutRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    workout = Workout(
        user_id=current_user.id,
        type=payload.type,
        exercise_name=payload.exerciseName,
        sets=payload.sets,
        reps=payload.reps,
        duration=payload.duration,
        notes=payload.notes,
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)

    estimated_calories = estimate_workout_calories_via_met(payload, current_user.weight or 70)
    dashboard_activity = Activity(
        user_id=current_user.id,
        kind="exercise",
        title=f"{payload.type.title()}: {payload.exerciseName}",
        calories=estimated_calories,
        duration=payload.duration,
        intensity=(
            "high"
            if payload.type.lower() == "hiit"
            else "low" if payload.type.lower() == "stability" else "moderate"
        ),
    )
    db.add(dashboard_activity)
    db.commit()

    return {"id": workout.id}


def _delete_workout_impl(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workout = (
        db.query(Workout)
        .filter(Workout.id == workout_id, Workout.user_id == current_user.id)
        .first()
    )
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    expected_title = f"{(workout.type or '').title()}: {workout.exercise_name}"
    lower_bound = workout.date - timedelta(minutes=10) if workout.date else None
    upper_bound = workout.date + timedelta(minutes=10) if workout.date else None

    activity_query = db.query(Activity).filter(
        Activity.user_id == current_user.id,
        Activity.kind == "exercise",
        Activity.title == expected_title,
    )
    if lower_bound and upper_bound:
        activity_query = activity_query.filter(
            Activity.created_at >= lower_bound,
            Activity.created_at <= upper_bound,
        )
    if workout.duration is not None:
        activity_query = activity_query.filter(Activity.duration == workout.duration)

    linked_activity = activity_query.order_by(Activity.created_at.desc()).first()
    if not linked_activity:
        linked_activity = (
            db.query(Activity)
            .filter(
                Activity.user_id == current_user.id,
                Activity.kind == "exercise",
                Activity.title == expected_title,
            )
            .order_by(Activity.created_at.desc())
            .first()
        )

    if linked_activity:
        db.delete(linked_activity)
    db.delete(workout)
    db.commit()
    return {"deleted": True, "workout_id": workout_id}


def _find_linked_activity(db: Session, current_user: User, workout: Workout) -> Activity | None:
    expected_title = f"{(workout.type or '').title()}: {workout.exercise_name}"
    lower_bound = workout.date - timedelta(minutes=10) if workout.date else None
    upper_bound = workout.date + timedelta(minutes=10) if workout.date else None

    activity_query = db.query(Activity).filter(
        Activity.user_id == current_user.id,
        Activity.kind == "exercise",
        Activity.title == expected_title,
    )
    if lower_bound and upper_bound:
        activity_query = activity_query.filter(
            Activity.created_at >= lower_bound,
            Activity.created_at <= upper_bound,
        )
    if workout.duration is not None:
        activity_query = activity_query.filter(Activity.duration == workout.duration)

    linked_activity = activity_query.order_by(Activity.created_at.desc()).first()
    if not linked_activity:
        linked_activity = (
            db.query(Activity)
            .filter(
                Activity.user_id == current_user.id,
                Activity.kind == "exercise",
                Activity.title == expected_title,
            )
            .order_by(Activity.created_at.desc())
            .first()
        )
    return linked_activity


@app.delete("/workout/{workout_id}")
def delete_workout(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _delete_workout_impl(workout_id, current_user, db)


@app.post("/workout/{workout_id}/delete")
def delete_workout_post(
    workout_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _delete_workout_impl(workout_id, current_user, db)


@app.patch("/workout/{workout_id}")
def update_workout(
    workout_id: int,
    payload: WorkoutUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workout = (
        db.query(Workout)
        .filter(Workout.id == workout_id, Workout.user_id == current_user.id)
        .first()
    )
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")

    if payload.sets is not None:
        if payload.sets <= 0:
            raise HTTPException(status_code=422, detail="sets must be > 0")
        workout.sets = payload.sets
    if payload.reps is not None:
        if payload.reps <= 0:
            raise HTTPException(status_code=422, detail="reps must be > 0")
        workout.reps = payload.reps
    if payload.duration is not None:
        if payload.duration <= 0:
            raise HTTPException(status_code=422, detail="duration must be > 0")
        workout.duration = payload.duration

    calories = _estimate_saved_workout_calories(
        workout,
        current_user.weight or 70,
        db,
        override_time_taken=payload.timeTaken,
    )
    linked_activity = _find_linked_activity(db, current_user, workout)
    if linked_activity:
        linked_activity.duration = workout.duration
        linked_activity.calories = calories

    db.add(workout)
    db.commit()
    db.refresh(workout)
    return {
        "updated": True,
        "id": workout.id,
        "sets": workout.sets,
        "reps": workout.reps,
        "duration": workout.duration,
        "caloriesBurned": calories,
        "timeTaken": payload.timeTaken if payload.timeTaken else (f"{int(workout.duration)}:00" if workout.duration else None),
    }


@app.get("/workout/history")
def workout_history(
    hours: int = Query(default=24, ge=1, le=24 * 30),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    since = datetime.utcnow() - timedelta(hours=hours)
    items = (
        db.query(Workout)
        .filter(Workout.user_id == current_user.id, Workout.date >= since)
        .order_by(Workout.date.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": i.id,
                "type": i.type,
                "exerciseName": i.exercise_name,
                "sets": i.sets,
                "reps": i.reps,
                "duration": i.duration,
                "notes": i.notes,
                "bodyPart": _parse_body_part_from_notes(i.notes),
                "caloriesBurned": _estimate_saved_workout_calories(i, current_user.weight or 70, db),
                "date": i.date.isoformat(),
            }
            for i in items
        ]
    }


@app.get("/workout/total-burn")
def workout_total_burn(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(Workout).filter(Workout.user_id == current_user.id).all()
    total = 0
    for row in rows:
        total += _estimate_saved_workout_calories(row, current_user.weight or 70, db)
    return {"totalCaloriesBurned": int(total), "sessionCount": len(rows)}


@app.post("/workout/coach/insight")
def workout_coach_insight(
    body: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = current_user
    payload = body if isinstance(body, dict) else {}
    workout_data = payload.get("workoutData") if isinstance(payload.get("workoutData"), dict) else {}
    if not workout_data:
        recent = (
            db.query(Workout)
            .filter(Workout.user_id == current_user.id)
            .order_by(Workout.date.desc())
            .limit(30)
            .all()
        )
        workout_data = {
            "recentWorkouts": [
                {
                    "date": i.date.isoformat(),
                    "type": i.type,
                    "musclesTrained": [],
                    "durationMin": i.duration or 0,
                }
                for i in recent[:5]
            ],
            "weeklyVolume": [],
            "muscleGroups": [],
            "lastWorkoutDate": recent[0].date.isoformat() if recent else "No workout yet",
            "totalWeeklySets": int(sum((i.sets or 0) for i in recent)),
            "targetWeeklySets": 84,
        }
    try:
        return _groq_workout_coach(workout_data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Workout AI insight generation failed: {str(e)}") from e


@app.get("/workout/coach/data")
def workout_coach_data(
    days: int = Query(default=14, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    base_muscles = ["Chest", "Shoulders", "Triceps", "Back", "Legs", "Biceps"]
    since = datetime.utcnow() - timedelta(days=days)

    rows = (
        db.query(Workout)
        .filter(Workout.user_id == current_user.id, Workout.date >= since)
        .order_by(Workout.date.desc())
        .all()
    )
    if not rows:
        return {
            "recentWorkouts": [],
            "weeklyVolume": [{"muscle": m, "sets": 0, "targetSets": 14, "color": c} for m, c in zip(base_muscles, ["#4ADE80", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#2DD4BF"])],
            "muscleGroups": [{"name": m, "status": "fresh", "recoveryPercent": 90, "lastTrainedLabel": "Not trained recently"} for m in base_muscles],
            "lastWorkoutDate": "No workout yet",
            "totalWeeklySets": 0,
            "targetWeeklySets": 84,
        }

    week_since = datetime.utcnow() - timedelta(days=7)
    by_muscle_sets: dict[str, int] = {m: 0 for m in base_muscles}
    last_trained: dict[str, datetime] = {}
    for w in rows:
        muscles = _infer_muscles_from_workout(w, db)
        sets = max(0, int(w.sets or 0))
        for m in muscles:
            if m not in by_muscle_sets:
                continue
            if w.date >= week_since:
                by_muscle_sets[m] += sets
            if m not in last_trained or w.date > last_trained[m]:
                last_trained[m] = w.date

    palette = {
        "Chest": "#4ADE80",
        "Shoulders": "#FBBF24",
        "Triceps": "#A78BFA",
        "Back": "#60A5FA",
        "Legs": "#F87171",
        "Biceps": "#2DD4BF",
    }
    weekly_volume = [{"muscle": m, "sets": by_muscle_sets[m], "targetSets": 14, "color": palette[m]} for m in base_muscles]
    muscle_groups = []
    for m in base_muscles:
        dt = last_trained.get(m)
        hours = (datetime.utcnow() - dt).total_seconds() / 3600 if dt else 168
        recovery = max(12, min(96, round((min(168, hours) / 168) * 100)))
        status = "sore" if recovery < 28 else "tired" if recovery < 52 else "ready" if recovery < 76 else "fresh"
        muscle_groups.append({"name": m, "status": status, "recoveryPercent": recovery, "lastTrainedLabel": _relative_label(dt)})

    recent_workouts = [
        {
            "date": _relative_label(w.date),
            "type": w.type,
            "musclesTrained": _infer_muscles_from_workout(w, db),
            "durationMin": int(w.duration or 0),
        }
        for w in rows[:5]
    ]
    total_weekly_sets = sum(v["sets"] for v in weekly_volume)
    target_weekly_sets = sum(v["targetSets"] for v in weekly_volume)
    return {
        "recentWorkouts": recent_workouts,
        "weeklyVolume": weekly_volume,
        "muscleGroups": muscle_groups,
        "lastWorkoutDate": _relative_label(rows[0].date),
        "totalWeeklySets": total_weekly_sets,
        "targetWeeklySets": target_weekly_sets,
    }


@app.get("/workout/catalog")
def workout_catalog(
    bodyPart: str | None = Query(default=None),
    type: str | None = Query(default=None),
    goalTag: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    exerciseName: str | None = Query(default=None),
    equipment: str | None = Query(default=None),
    recommendation: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    base_query = db.query(WorkoutCatalog)
    active_goal_tag = normalize_optional_filter(goalTag)
    active_difficulty = normalize_optional_filter(difficulty)

    if bodyPart:
        base_query = base_query.filter(WorkoutCatalog.body_part == bodyPart)
    if type:
        base_query = base_query.filter(WorkoutCatalog.type == type)
    if active_difficulty:
        base_query = base_query.filter(WorkoutCatalog.difficulty == active_difficulty)
    if exerciseName:
        base_query = base_query.filter(WorkoutCatalog.exercise_name == exerciseName)
    if equipment:
        base_query = base_query.filter(WorkoutCatalog.equipment == equipment)
    if active_goal_tag:
        base_query = base_query.filter(WorkoutCatalog.goal_tag == active_goal_tag)
    rows = base_query.all()
    if recommendation:
        rows = [r for r in rows if build_recommendation(r) == recommendation]

    def uniq(values: list[str]) -> list[str]:
        return sorted(list({v for v in values if v}))

    options_query = db.query(WorkoutCatalog)
    if active_goal_tag:
        options_query = options_query.filter(WorkoutCatalog.goal_tag == active_goal_tag)
    if active_difficulty:
        options_query = options_query.filter(WorkoutCatalog.difficulty == active_difficulty)
    if bodyPart:
        options_query = options_query.filter(WorkoutCatalog.body_part == bodyPart)
    if type:
        options_query = options_query.filter(WorkoutCatalog.type == type)
    if exerciseName:
        options_query = options_query.filter(WorkoutCatalog.exercise_name == exerciseName)
    if equipment:
        options_query = options_query.filter(WorkoutCatalog.equipment == equipment)

    option_rows = options_query.all()
    if recommendation:
        option_rows = [r for r in option_rows if build_recommendation(r) == recommendation]
    body_part_base = db.query(WorkoutCatalog)
    if active_goal_tag:
        body_part_base = body_part_base.filter(WorkoutCatalog.goal_tag == active_goal_tag)
    if active_difficulty:
        body_part_base = body_part_base.filter(WorkoutCatalog.difficulty == active_difficulty)
    body_part_options = uniq([r.body_part for r in body_part_base.all()])
    type_options = uniq([r.type for r in option_rows]) if bodyPart else []
    goal_tag_options = uniq([r.goal_tag for r in option_rows])
    difficulty_options = uniq([r.difficulty for r in option_rows])
    exercise_options = uniq([r.exercise_name for r in option_rows]) if bodyPart else []
    equipment_options = uniq([r.equipment for r in option_rows]) if exerciseName else []
    recommendation_options = uniq([build_recommendation(r) for r in option_rows]) if exerciseName else []

    return {
        "items": [
            {
                "type": r.type,
                "bodyPart": r.body_part,
                "goalTag": r.goal_tag,
                "difficulty": r.difficulty,
                "exerciseName": r.exercise_name,
                "equipment": r.equipment,
                "recommendation": build_recommendation(r),
                "sets": r.sets_recommended,
                "reps": r.reps_recommended,
                "duration": r.rest_time_sec,
                "metValue": r.met_value,
                "recommendedWeightKg": {
                    "beginner": "bodyweight" if r.difficulty.lower() == "beginner" else r.recommended_weight_kg,
                    "intermediate": r.recommended_weight_kg,
                    "advanced": r.recommended_weight_kg,
                },
            }
            for r in rows
        ],
        "options": {
            "type": type_options,
            "bodyPart": body_part_options,
            "goalTag": goal_tag_options,
            "difficulty": difficulty_options,
            "exerciseName": exercise_options,
            "equipment": equipment_options,
            "recommendation": recommendation_options,
        },
    }


@app.get("/workout/preferences/options")
def workout_preference_options(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(WorkoutCatalog).all()
    goal_tag_options = sorted(list({r.goal_tag for r in rows if r.goal_tag}))
    difficulty_options = sorted(list({r.difficulty for r in rows if r.difficulty}))
    return {"goalTag": goal_tag_options, "difficulty": difficulty_options}


@app.post("/meal")
def meal(payload: MealRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = Meal(
        user_id=current_user.id,
        name=payload.name,
        calories=payload.calories,
        protein=payload.protein,
        carbs=payload.carbs,
        fat=payload.fat,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id}


@app.get("/calories")
def calories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.query(Meal).filter(Meal.user_id == current_user.id).order_by(Meal.date.desc()).all()
    return {
        "totalCalories": sum(i.calories for i in items),
        "items": [
            {
                "id": i.id,
                "name": i.name,
                "calories": i.calories,
                "protein": i.protein,
                "carbs": i.carbs,
                "fat": i.fat,
                "date": i.date.isoformat(),
            }
            for i in items
        ],
    }


@app.post("/ai/chat")
def chat(payload: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workouts = db.query(Workout).filter(Workout.user_id == current_user.id).count()
    meals = db.query(Meal).filter(Meal.user_id == current_user.id).count()
    score = compute_discipline_score(workouts, meals, workouts + meals)
    return {
        "reply": (
            f"You have logged {workouts} workouts and {meals} meals. "
            f"Discipline score is {score}. Focus on one cardio and one strength session today."
        )
    }


@app.get("/profile")
def profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Re-apply onboarding mapping on read so legacy users stay in sync.
    onboarding_row = db.query(UserOnboarding).filter(UserOnboarding.user_id == current_user.id).first()
    if onboarding_row and isinstance(onboarding_row.onboarding_json, dict):
        apply_onboarding_personal_to_user(current_user, onboarding_row.onboarding_json)
        db.add(current_user)
        db.commit()
        db.refresh(current_user)

    workouts = db.query(Workout).filter(Workout.user_id == current_user.id).count()
    meals = db.query(Meal).filter(Meal.user_id == current_user.id).count()
    activity_logs = db.query(Activity).filter(Activity.user_id == current_user.id).count()
    score = compute_discipline_score(workouts, meals, activity_logs)

    return {
        "id": str(current_user.id),
        "name": current_user.name,
        "email": current_user.email,
        "age": current_user.age,
        "weight": current_user.weight,
        "goals": current_user.goals,
        "goalTag": current_user.goal_tag,
        "difficulty": current_user.difficulty,
        "createdAt": current_user.created_at.isoformat() if current_user.created_at else None,
        "disciplineScore": score,
    }


@app.put("/profile")
def update_profile(
    payload: ProfileRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    current_user.name = payload.name
    current_user.age = payload.age
    current_user.weight = payload.weight
    current_user.goals = payload.goals
    current_user.goal_tag = (payload.goalTag or "").strip()
    current_user.difficulty = (payload.difficulty or "").strip()
    db.add(current_user)
    db.commit()

    workouts = db.query(Workout).filter(Workout.user_id == current_user.id).count()
    meals = db.query(Meal).filter(Meal.user_id == current_user.id).count()
    activity_logs = db.query(Activity).filter(Activity.user_id == current_user.id).count()
    score = compute_discipline_score(workouts, meals, activity_logs)

    return {
        "id": str(current_user.id),
        "name": current_user.name,
        "email": current_user.email,
        "age": current_user.age,
        "weight": current_user.weight,
        "goals": current_user.goals,
        "goalTag": current_user.goal_tag,
        "difficulty": current_user.difficulty,
        "createdAt": current_user.created_at.isoformat() if current_user.created_at else None,
        "disciplineScore": score,
    }
