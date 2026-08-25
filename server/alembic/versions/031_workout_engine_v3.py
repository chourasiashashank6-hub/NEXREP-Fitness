"""Workout engine v3: global_exercises.cues column + catalog gap exercises.

Revision ID: 031_workout_engine_v3
Revises: 030_journey_events
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "031_workout_engine_v3"
down_revision = "030_journey_events"
branch_labels = None
depends_on = None

NEW_EXERCISES = [
    {
        "name": "Close-Grip Push-Up",
        "aliases": ["Close Grip Push Up", "Narrow Push-Up"],
        "body_part": "Arms",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Triceps"],
        "muscles_secondary": ["Pectoralis Major", "Anterior Deltoid"],
        "met_value": 4.0,
        "difficulty": "Beginner",
        "is_compound": False,
        "cues": [
            "Hands shoulder-width, elbows stay close to ribs",
            "Lower chest to hands with a straight line head to heels",
            "Press up and squeeze triceps at the top",
        ],
    },
    {
        "name": "Bodyweight Tricep Extension",
        "aliases": ["Floor Tricep Extension"],
        "body_part": "Arms",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Triceps"],
        "muscles_secondary": [],
        "met_value": 3.5,
        "difficulty": "Beginner",
        "is_compound": False,
        "cues": [
            "Keep elbows fixed, hinge only at the elbow",
            "Lower forehead toward hands under control",
            "Extend arms fully without locking aggressively",
        ],
    },
    {
        "name": "Archer Push-Up",
        "aliases": [],
        "body_part": "Arms",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Triceps", "Pectoralis Major"],
        "muscles_secondary": ["Anterior Deltoid"],
        "met_value": 5.0,
        "difficulty": "Intermediate",
        "is_compound": False,
        "cues": [
            "Shift weight to one arm as you descend",
            "Keep the straight arm extended for balance",
            "Alternate sides each rep or set",
        ],
    },
    {
        "name": "Pike Push-Up",
        "aliases": ["Pike Press"],
        "body_part": "Shoulders",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Anterior Deltoid"],
        "muscles_secondary": ["Triceps", "Upper Pectoralis Major"],
        "met_value": 4.5,
        "difficulty": "Beginner",
        "is_compound": True,
        "cues": [
            "Hips high, body forms an inverted V",
            "Lower head between hands, not chest to floor",
            "Press through shoulders, not just arms",
        ],
    },
    {
        "name": "Handstand Push-Up",
        "aliases": ["HSPU"],
        "body_part": "Shoulders",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Anterior Deltoid"],
        "muscles_secondary": ["Triceps", "Upper Trapezius"],
        "met_value": 6.0,
        "difficulty": "Advanced",
        "is_compound": True,
        "cues": [
            "Brace core and glutes — avoid arching",
            "Lower under control to a safe depth",
            "Press explosively but stay stacked over hands",
        ],
    },
    {
        "name": "Wall Walk",
        "aliases": [],
        "body_part": "Shoulders",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Anterior Deltoid"],
        "muscles_secondary": ["Triceps", "Core"],
        "met_value": 5.0,
        "difficulty": "Intermediate",
        "is_compound": False,
        "cues": [
            "Walk feet up the wall in small steps",
            "Keep hands under shoulders throughout",
            "Walk back down with the same control",
        ],
    },
    {
        "name": "Scapular Pull-Up",
        "aliases": ["Scap Pull"],
        "body_part": "Back",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Latissimus Dorsi"],
        "muscles_secondary": ["Rhomboids", "Lower Trapezius"],
        "met_value": 3.5,
        "difficulty": "Beginner",
        "is_compound": False,
        "cues": [
            "Hang with straight arms, depress shoulder blades",
            "Pull shoulders down without bending elbows",
            "Control the return — don't drop into passive hang",
        ],
    },
    {
        "name": "Superman Hold",
        "aliases": ["Superman"],
        "body_part": "Back",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Erector Spinae"],
        "muscles_secondary": ["Gluteus Maximus"],
        "met_value": 3.0,
        "difficulty": "Beginner",
        "is_compound": False,
        "cues": [
            "Lift chest and thighs off the floor together",
            "Keep neck neutral — look at the floor",
            "Hold briefly, lower with control",
        ],
    },
    {
        "name": "Side Plank",
        "aliases": [],
        "body_part": "Core",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Obliques"],
        "muscles_secondary": ["Transverse Abdominis"],
        "met_value": 3.0,
        "difficulty": "Beginner",
        "is_compound": False,
        "cues": [
            "Stack shoulders over elbow or hand",
            "Lift hips — straight line head to feet",
            "Breathe steadily, don't let hips sag",
        ],
    },
    {
        "name": "Sumo Squat",
        "aliases": ["Bodyweight Sumo Squat"],
        "body_part": "Legs",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Quadriceps", "Adductors"],
        "muscles_secondary": ["Gluteus Maximus"],
        "met_value": 5.0,
        "difficulty": "Beginner",
        "is_compound": True,
        "cues": [
            "Wide stance, toes turned out slightly",
            "Push knees out over toes as you descend",
            "Drive through heels to stand",
        ],
    },
    {
        "name": "Hip Thrust",
        "aliases": ["Glute Bridge", "Bodyweight Hip Thrust"],
        "body_part": "Legs",
        "category": "Calisthenics",
        "equipment": "Bodyweight",
        "muscles_primary": ["Gluteus Maximus"],
        "muscles_secondary": ["Hamstrings"],
        "met_value": 4.5,
        "difficulty": "Beginner",
        "is_compound": True,
        "cues": [
            "Upper back on bench or floor, feet flat",
            "Drive hips up, squeeze glutes at top",
            "Lower under control — don't hyperextend",
        ],
    },
]


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE global_exercises ADD COLUMN IF NOT EXISTS cues JSONB"))
    for ex in NEW_EXERCISES:
        cues_json = sa.text("CAST(:cues AS jsonb)")
        op.execute(
            sa.text(
                """
                INSERT INTO global_exercises (
                    name, aliases, body_part, category, equipment,
                    muscles_primary, muscles_secondary, met_value, difficulty, is_compound, cues
                )
                SELECT :name, :aliases, :body_part, :category, :equipment,
                       :muscles_primary, :muscles_secondary, :met_value, :difficulty, :is_compound, CAST(:cues AS jsonb)
                WHERE NOT EXISTS (
                    SELECT 1 FROM global_exercises WHERE lower(name) = lower(:name)
                )
                """
            ).bindparams(
                name=ex["name"],
                aliases=ex["aliases"],
                body_part=ex["body_part"],
                category=ex["category"],
                equipment=ex["equipment"],
                muscles_primary=ex["muscles_primary"],
                muscles_secondary=ex["muscles_secondary"],
                met_value=ex["met_value"],
                difficulty=ex["difficulty"],
                is_compound=ex["is_compound"],
                cues=__import__("json").dumps(ex["cues"]),
            )
        )


def downgrade() -> None:
    names = [ex["name"] for ex in NEW_EXERCISES]
    for name in names:
        op.execute(sa.text("DELETE FROM global_exercises WHERE lower(name) = lower(:n)").bindparams(n=name))
    op.execute(sa.text("ALTER TABLE global_exercises DROP COLUMN IF EXISTS cues"))
