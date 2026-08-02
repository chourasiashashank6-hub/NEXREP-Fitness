"""Add food_items.region + is_supplement; backfill supplements, regions, exclude composites from pool via flags."""

from alembic import op
import sqlalchemy as sa


revision = "018_food_item_region_supplement"
down_revision = "017_food_item_serving_units"
branch_labels = None
depends_on = None


# food_id → region for dishes already seen mixing / high-priority Indian catalog.
REGION_BY_ID: dict[int, str] = {
    # Explicit mismatches from testing
    439: "rajasthani",  # Dal baati churma
    443: "north_indian",  # Shahi paneer
    423: "maharashtrian",  # Misal pav
    437: "south_indian",  # Akki roti
    605: "western",  # Seitan
    # Staples
    1: "pan_indian",
    2: "pan_indian",
    3: "pan_indian",
    4: "north_indian",
    5: "north_indian",
    6: "north_indian",
    7: "north_indian",
    8: "north_indian",
    9: "punjabi",
    10: "south_indian",
    11: "south_indian",
    12: "south_indian",
    13: "south_indian",
    14: "south_indian",
    15: "west_indian",  # poha — common MH/central
    16: "pan_indian",
    # Curries
    44: "punjabi",
    45: "punjabi",
    46: "punjabi",
    47: "punjabi",
    48: "north_indian",
    49: "punjabi",
    50: "pan_indian",
    51: "south_indian",
    52: "south_indian",
    53: "punjabi",
    54: "punjabi",
    55: "pan_indian",
    56: "north_indian",
    57: "south_indian",
    58: "pan_indian",
    59: "west_indian",
    60: "north_indian",
    61: "pan_indian",
    62: "pan_indian",
    63: "pan_indian",
    64: "punjabi",
    65: "north_indian",
    66: "pan_indian",
    67: "north_indian",
    68: "north_indian",
    69: "north_indian",
    70: "punjabi",
    71: "north_indian",
    72: "north_indian",
    73: "north_indian",
    74: "punjabi",
    75: "pan_indian",
    76: "punjabi",
    # Snacks
    77: "north_indian",
    78: "pan_indian",
    79: "maharashtrian",
    80: "maharashtrian",
    81: "maharashtrian",
    82: "north_indian",
    83: "gujarati",
    84: "rajasthani",
    85: "south_indian",
    86: "north_indian",
    87: "north_indian",
    88: "north_indian",
    89: "maharashtrian",
    90: "pan_indian",
    91: "pan_indian",
    92: "pan_indian",
    93: "gujarati",
    94: "gujarati",
    95: "maharashtrian",
    96: "south_indian",
    422: "maharashtrian",
    424: "maharashtrian",
    425: "maharashtrian",
    426: "maharashtrian",
    427: "maharashtrian",
    428: "south_indian",
    429: "south_indian",
    430: "south_indian",
    431: "south_indian",
    432: "south_indian",
    440: "rajasthani",
    441: "rajasthani",
    442: "rajasthani",
    444: "north_indian",
    445: "north_indian",
    446: "punjabi",
}

# Name substrings → region (applied when not already set by ID)
NAME_REGION_RULES: list[tuple[str, str]] = [
    ("idli", "south_indian"),
    ("dosa", "south_indian"),
    ("sambar", "south_indian"),
    ("rasam", "south_indian"),
    ("uttapam", "south_indian"),
    ("appam", "south_indian"),
    ("puttu", "south_indian"),
    ("avial", "south_indian"),
    ("chettinad", "south_indian"),
    ("filter coffee", "south_indian"),
    ("medu vada", "south_indian"),
    ("murukku", "south_indian"),
    ("poha", "maharashtrian"),
    ("misal", "maharashtrian"),
    ("vada pav", "maharashtrian"),
    ("pav bhaji", "maharashtrian"),
    ("bhel", "maharashtrian"),
    ("sol kadhi", "maharashtrian"),
    ("kolhapuri", "maharashtrian"),
    ("puran poli", "maharashtrian"),
    ("thepla", "gujarati"),
    ("dhokla", "gujarati"),
    ("handvo", "gujarati"),
    ("undhiyu", "gujarati"),
    ("fafda", "gujarati"),
    ("dal baati", "rajasthani"),
    ("gatte", "rajasthani"),
    ("ker sangri", "rajasthani"),
    ("laal maas", "rajasthani"),
    ("sarso", "punjabi"),
    ("makki", "punjabi"),
    ("chole", "punjabi"),
    ("rajma", "punjabi"),
    ("butter chicken", "punjabi"),
    ("dal makhani", "punjabi"),
    ("paneer", "north_indian"),
    ("paratha", "north_indian"),
    ("chapati", "north_indian"),
    ("roti", "north_indian"),
    ("naan", "north_indian"),
    ("samosa", "north_indian"),
    ("aloo tikki", "north_indian"),
    ("rogan josh", "north_indian"),
    ("shahi", "north_indian"),
    ("biryani", "pan_indian"),
    ("fish curry (bengali", "bengali"),
    ("ilish", "bengali"),
    ("rosogolla", "bengali"),
    ("rasgulla", "bengali"),
    ("mishti doi", "bengali"),
    ("seitan", "western"),
    ("tempeh", "western"),
    ("tofu", "western"),
    ("quinoa", "western"),
    ("bagel", "western"),
    ("croissant", "western"),
    ("pasta", "western"),
    ("pizza", "western"),
    ("burger", "western"),
    ("sushi", "western"),
    ("kimchi", "western"),
    ("taco", "western"),
    ("burrito", "western"),
]

CATEGORY_DEFAULT_REGION: dict[str, str] = {
    "Indian_Staple": "pan_indian",
    "Indian_Curry": "pan_indian",
    "Indian_Snack": "pan_indian",
    "Indian_Sweet": "pan_indian",
    "Legume_Pulse": "pan_indian",
    "Grain_Cereal": "pan_indian",
    "Dairy": "pan_indian",
    "Beverage": "pan_indian",
    "Fruit": "pan_indian",
    "Nut_Seed": "pan_indian",
    "Protein_Egg": "pan_indian",
    "Vegetable": "pan_indian",
    "Soup_Stew": "pan_indian",
    "Protein_Meat": "western",  # non-Indian meats often western; Indian meat curries already tagged
    "Protein_Seafood": "pan_indian",
    "Chinese": "western",
    "Japanese": "western",
    "Korean": "western",
    "Thai": "western",
    "Mexican": "western",
    "Mediterranean": "western",
    "Middle_Eastern": "western",
    "Western_Main": "western",
    "Pasta_Noodle": "western",
    "Bread_Bakery": "western",
    "Fast_Food": "western",
    "Dessert_Sweet": "western",
    "Processed_Snack": "western",
}

SUPPLEMENT_NAME_PATTERNS = (
    "%whey%",
    "%casein%",
    "%creatine%",
    "%bcaa%",
    "%mass gainer%",
    "%protein powder%",
    "%protein shake%",
    "%pre-workout%",
    "%preworkout%",
    "%collagen peptide%",
    "%isolate protein%",
)

# Known composite / combo dish rows — excluded from AI pool via is_composite logic in app;
# also left tagged so tests can assert denylist.
COMPOSITE_FOOD_IDS = (439,)  # Dal baati churma — needs split later


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS is_supplement BOOLEAN NOT NULL DEFAULT FALSE"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS region VARCHAR(32)"))
    op.execute(sa.text("ALTER TABLE food_items ADD COLUMN IF NOT EXISTS is_composite BOOLEAN NOT NULL DEFAULT FALSE"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_food_items_region ON food_items (region)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_food_items_is_supplement ON food_items (is_supplement)"))

    conn = op.get_bind()

    # 1) Supplements by name
    for pattern in SUPPLEMENT_NAME_PATTERNS:
        conn.execute(
            sa.text(
                """
                UPDATE food_items
                SET is_supplement = TRUE
                WHERE LOWER(food_name) LIKE :pat
                """
            ),
            {"pat": pattern},
        )

    # 2) Composite denylist
    for fid in COMPOSITE_FOOD_IDS:
        conn.execute(
            sa.text("UPDATE food_items SET is_composite = TRUE WHERE food_id = :fid"),
            {"fid": fid},
        )
    conn.execute(
        sa.text(
            """
            UPDATE food_items
            SET is_composite = TRUE
            WHERE LOWER(food_name) LIKE '%baati churma%'
               OR LOWER(food_name) LIKE '%dal baati%'
               OR LOWER(food_name) LIKE '%thali%'
            """
        )
    )

    # 3) Region by explicit food_id
    for food_id, region in REGION_BY_ID.items():
        conn.execute(
            sa.text("UPDATE food_items SET region = :region WHERE food_id = :fid"),
            {"region": region, "fid": food_id},
        )

    # 4) Region by name rules (only where still null)
    for needle, region in NAME_REGION_RULES:
        conn.execute(
            sa.text(
                """
                UPDATE food_items
                SET region = :region
                WHERE region IS NULL
                  AND LOWER(food_name) LIKE :pat
                """
            ),
            {"region": region, "pat": f"%{needle}%"},
        )

    # 5) Category defaults for remaining unit-seeded rows still null
    for category, region in CATEGORY_DEFAULT_REGION.items():
        conn.execute(
            sa.text(
                """
                UPDATE food_items f
                SET region = :region
                FROM food_categories c
                WHERE f.category_id = c.category_id
                  AND c.category_name = :cat
                  AND f.region IS NULL
                  AND f.unit_label IS NOT NULL
                """
            ),
            {"region": region, "cat": category},
        )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS idx_food_items_is_supplement"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_food_items_region"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS is_composite"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS region"))
    op.execute(sa.text("ALTER TABLE food_items DROP COLUMN IF EXISTS is_supplement"))
