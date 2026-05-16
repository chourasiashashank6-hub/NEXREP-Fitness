from src.db.session import Base, SessionLocal, engine
from src.models.models import Activity, Meal, User, Workout
from src.models.nutrition_calories import (  # noqa: F401 — register tables
    AIFoodMealEntry,
    DailyNutritionLog,
    MealEntry,
    WaterIntakeLog,
)
from src.services.auth_service import hash_password
from src.services.food_catalog_service import ensure_food_catalog_schema, load_food_catalog_from_sql_if_empty
from src.services.workout_catalog_service import load_workout_catalog_if_empty


def ensure_tables() -> None:
    """Create tables if missing (same as API startup). Safe to run before or after uvicorn."""
    Base.metadata.create_all(bind=engine)


def run_seed():
    ensure_tables()
    ensure_food_catalog_schema(engine)
    food_count = load_food_catalog_from_sql_if_empty(engine)
    if food_count:
        print(f"Food catalog loaded: {food_count} items")
    imported = load_workout_catalog_if_empty(engine)
    if imported:
        print(f"Workout catalog loaded: {imported} exercises")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "demo@fit.com").first()
        if user:
            print("Demo user already exists")
            return

        user = User(
            name="Demo User",
            email="demo@fit.com",
            password_hash=hash_password("demo1234"),
            age=28,
            weight=72,
            goals="Improve consistency",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        db.add_all([
            Workout(user_id=user.id, type="cardio", exercise_name="Jogging", duration=30),
            Workout(user_id=user.id, type="strength", exercise_name="Push Ups", sets=4, reps=12),
            Meal(user_id=user.id, name="Oatmeal", calories=320, protein=12, carbs=45, fat=8),
            Meal(user_id=user.id, name="Chicken Bowl", calories=540, protein=35, carbs=52, fat=18),
            Activity(user_id=user.id, kind="exercise", title="Morning jog", duration=30),
            Activity(user_id=user.id, kind="meal", title="Lunch bowl", calories=540),
        ])
        db.commit()
        print("Seed complete: demo@fit.com / demo1234")
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()
