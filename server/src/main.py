from datetime import datetime, timedelta
from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from src.db.session import Base, engine, get_db
from src.models.models import Activity, Meal, User, UserOnboarding, Workout, WorkoutCatalog
from src.schemas.schemas import (
    ActivityRequest,
    ChatRequest,
    LoginRequest,
    MealRequest,
    OnboardingUpsertRequest,
    ProfileRequest,
    SignupRequest,
    WorkoutRequest,
)
from src.services.auth_service import create_access_token, hash_password, verify_password
from src.services.score_service import compute_discipline_score
from src.utils.auth import get_current_user

app = FastAPI(title="Fitness API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Lightweight check that the API process is up (use before login from the app)."""
    return {"status": "ok"}


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    apply_schema_updates()


def apply_schema_updates() -> None:
    """
    Lightweight schema patches for local environments without migrations.
    """
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_tag VARCHAR(128) DEFAULT 'Fat Loss'"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS difficulty VARCHAR(64) DEFAULT 'Beginner'"))


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
    time_in_hours = parse_time_taken_to_hours(payload.timeTaken)
    if time_in_hours is None or time_in_hours <= 0:
        return estimate_workout_calories(payload)
    met_value = payload.metValue if payload.metValue and payload.metValue > 0 else met_from_difficulty_and_volume(payload.difficulty, payload.sets, payload.reps)
    # Requested formula: calorie_burnt = met_value * body_weight(kg) * time(in hrs)
    calories = met_value * body_weight_kg * time_in_hours
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


@app.get("/workout/history")
def workout_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(hours=24)
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
                "caloriesBurned": estimate_workout_calories(
                    WorkoutRequest(
                        type=i.type,
                        exerciseName=i.exercise_name,
                        sets=i.sets,
                        reps=i.reps,
                        duration=i.duration,
                    )
                ),
                "date": i.date.isoformat(),
            }
            for i in items
        ]
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
        "disciplineScore": score,
    }
