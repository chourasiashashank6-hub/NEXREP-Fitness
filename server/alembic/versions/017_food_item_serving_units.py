"""Add serving-unit columns to food_items and seed common meal foods."""

from alembic import op
import sqlalchemy as sa


revision = "017_food_item_serving_units"
down_revision = "016_workout_sessions"
branch_labels = None
depends_on = None


# food_id -> (unit_label, unit_grams) overrides for high-frequency meal-planner foods.
# Per-unit macros are derived from calories_per_100g * (unit_grams / 100).
SEED_OVERRIDES: dict[int, tuple[str, float]] = {
    383: ("small cup", 150),  # Masala chai
    15: ("medium bowl", 150),  # Poha
    224: ("tbsp roasted", 15),  # Peanuts
    4: ("piece (medium)", 40),  # Chapati
    75: ("medium bowl", 150),  # Dal tadka
    31: ("medium bowl", 150),  # Toor dal
    32: ("medium bowl", 150),  # Moong dal
    33: ("medium bowl", 150),  # Masoor dal
    3: ("medium bowl, cooked", 150),  # Brown rice
    1: ("medium bowl, cooked", 150),  # Basmati
    2: ("medium bowl, cooked", 150),  # White rice
    36: ("medium bowl", 150),  # Rajma
    37: ("medium bowl", 150),  # Chole
    47: ("medium bowl", 150),  # Chole masala
    14: ("medium bowl", 150),  # Upma
    10: ("piece (medium)", 50),  # Idli
    51: ("medium bowl", 150),  # Sambar
    216: ("small bowl", 150),  # Curd
    207: ("serving", 100),  # Paneer
    445: ("medium bowl", 150),  # Paneer bhurji
    200: ("piece", 50),  # Boiled egg
    143: ("piece (medium)", 120),  # Banana
    410: ("tbsp", 16),  # Peanut butter
    379: ("glass", 240),  # Coconut water
    385: ("serving", 300),  # Protein shake
    25: ("medium bowl", 200),  # Oats cooked
    44: ("medium bowl", 150),  # Dal makhani
    45: ("medium bowl", 150),  # Palak paneer
    53: ("medium bowl", 150),  # Butter chicken
    55: ("medium bowl", 150),  # Chicken curry
    58: ("medium bowl", 150),  # Egg curry
    80: ("serving", 200),  # Pav bhaji
    77: ("piece", 50),  # Samosa
    211: ("small bowl", 150),  # Greek yogurt
    221: ("handful", 28),  # Almonds
}


CATEGORY_DEFAULTS: dict[str, tuple[str, float]] = {
    "Beverage": ("cup", 150),
    "Bread_Bakery": ("slice", 30),
    "Dairy": ("small bowl", 150),
    "Fruit": ("piece (medium)", 120),
    "Grain_Cereal": ("medium bowl, cooked", 150),
    "Indian_Curry": ("medium bowl", 150),
    "Indian_Snack": ("serving", 80),
    "Indian_Staple": ("serving", 100),
    "Legume_Pulse": ("medium bowl", 150),
    "Nut_Seed": ("handful", 28),
    "Protein_Egg": ("piece", 50),
    "Protein_Meat": ("serving", 120),
    "Protein_Seafood": ("serving", 120),
    "Soup_Stew": ("medium bowl", 200),
    "Vegetable": ("medium bowl", 120),
    "Western_Main": ("serving", 150),
    "Mediterranean": ("serving", 150),
    "Middle_Eastern": ("serving", 150),
    "Mexican": ("serving", 150),
    "Thai": ("serving", 150),
    "Chinese": ("serving", 150),
    "Japanese": ("serving", 150),
    "Korean": ("serving", 150),
    "Pasta_Noodle": ("medium bowl, cooked", 150),
    "Indian_Sweet": ("piece", 40),
    "Dessert_Sweet": ("serving", 80),
    "Fast_Food": ("serving", 150),
    "Processed_Snack": ("serving", 40),
}

# Categories left without units until hand-authored (excluded from AI pool).
EXCLUDED_CATEGORIES = ("Oil_Fat", "Sauce_Condiment")


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS unit_label VARCHAR(64)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS unit_grams NUMERIC(9,2)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS kcal_per_unit NUMERIC(9,2)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS protein_per_unit NUMERIC(9,2)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS carbs_per_unit NUMERIC(9,2)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS fat_per_unit NUMERIC(9,2)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_food_items_unit_label ON food_items (unit_label)"))

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT f.food_id, f.food_name, c.category_name, f.serving_size_g,
                   f.calories_per_100g, f.protein_g, f.carbs_g, f.fat_g
            FROM food_items f
            JOIN food_categories c ON c.category_id = f.category_id
            """
        )
    ).mappings().all()

    for row in rows:
        food_id = int(row["food_id"])
        category = str(row["category_name"] or "")
        if category in EXCLUDED_CATEGORIES:
            continue
        # Skip alcoholic beverages by name heuristic
        name_l = str(row["food_name"] or "").lower()
        if any(x in name_l for x in ("beer", "wine", "whisky", "rum", "vodka", "alcohol")):
            continue

        if food_id in SEED_OVERRIDES:
            unit_label, unit_grams = SEED_OVERRIDES[food_id]
        elif category in CATEGORY_DEFAULTS:
            unit_label, default_g = CATEGORY_DEFAULTS[category]
            serving = float(row["serving_size_g"] or 0)
            unit_grams = serving if serving > 0 else default_g
        else:
            continue

        cal100 = float(row["calories_per_100g"] or 0)
        p100 = float(row["protein_g"] or 0)
        c100 = float(row["carbs_g"] or 0)
        f100 = float(row["fat_g"] or 0)
        factor = unit_grams / 100.0
        conn.execute(
            sa.text(
                """
                UPDATE food_items
                SET unit_label = :unit_label,
                    unit_grams = :unit_grams,
                    kcal_per_unit = :kcal_per_unit,
                    protein_per_unit = :protein_per_unit,
                    carbs_per_unit = :carbs_per_unit,
                    fat_per_unit = :fat_per_unit
                WHERE food_id = :food_id
                """
            ),
            {
                "food_id": food_id,
                "unit_label": unit_label,
                "unit_grams": round(unit_grams, 2),
                "kcal_per_unit": round(cal100 * factor, 2),
                "protein_per_unit": round(p100 * factor, 2),
                "carbs_per_unit": round(c100 * factor, 2),
                "fat_per_unit": round(f100 * factor, 2),
            },
        )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS idx_food_items_unit_label"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS fat_per_unit"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS carbs_per_unit"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS protein_per_unit"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS kcal_per_unit"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS unit_grams"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS unit_label"))
