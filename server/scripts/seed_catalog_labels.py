from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from src.db.session import engine  # noqa: E402
from src.services.catalog_label_service import seed_catalog_labels, validate_catalog_label_coverage  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed language-tagged catalog labels.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing generated labels.")
    parser.add_argument("--validate-only", action="store_true", help="Only validate label coverage.")
    args = parser.parse_args()

    if not args.validate_only:
        counts = seed_catalog_labels(engine, overwrite=args.overwrite)
        print(json.dumps({"seeded": counts}, ensure_ascii=False, indent=2))

    coverage = validate_catalog_label_coverage(engine)
    print(json.dumps({"coverage": coverage}, ensure_ascii=False, indent=2))
    ok = (
        coverage["expected_exercise_labels"] == coverage["actual_exercise_labels"]
        and coverage["expected_food_item_labels"] == coverage["actual_food_item_labels"]
        and coverage["expected_food_category_labels"] == coverage["actual_food_category_labels"]
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
