import argparse
import hashlib
import json
from pathlib import Path

import psycopg


def read_dataset(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Expected a JSON array of exercise objects.")
    return raw


def normalize_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def normalize_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(description="Import exercise catalog into workout_catalog_v2")
    parser.add_argument(
        "--json-path",
        default="/Users/vishay_11/Downloads/Final_281_Exercises .json",
        help="Path to source JSON file",
    )
    parser.add_argument(
        "--database-url",
        default="postgresql://postgres:postgres@localhost:5432/fitnessdb",
        help="PostgreSQL connection URL",
    )
    args = parser.parse_args()

    json_path = Path(args.json_path)
    if not json_path.exists():
        raise FileNotFoundError(f"JSON file not found: {json_path}")

    rows = read_dataset(json_path)
    source_hash = hashlib.sha256(json_path.read_bytes()).hexdigest()

    insert_sql = """
    INSERT INTO workout_catalog_v2 (
      exercise_name, body_part, type, equipment, difficulty, met_value,
      goal_tag, sets_recommended, reps_recommended, rest_time_sec,
      recommended_weight_kg, video_url, source_file, source_hash
    ) VALUES (
      %(exercise_name)s, %(body_part)s, %(type)s, %(equipment)s, %(difficulty)s, %(met_value)s,
      %(goal_tag)s, %(sets_recommended)s, %(reps_recommended)s, %(rest_time_sec)s,
      %(recommended_weight_kg)s, %(video_url)s, %(source_file)s, %(source_hash)s
    )
    ON CONFLICT (exercise_name, body_part, type, equipment, difficulty, goal_tag)
    DO UPDATE SET
      met_value = EXCLUDED.met_value,
      sets_recommended = EXCLUDED.sets_recommended,
      reps_recommended = EXCLUDED.reps_recommended,
      rest_time_sec = EXCLUDED.rest_time_sec,
      recommended_weight_kg = EXCLUDED.recommended_weight_kg,
      video_url = EXCLUDED.video_url,
      source_file = EXCLUDED.source_file,
      source_hash = EXCLUDED.source_hash;
    """

    payloads = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        payloads.append(
            {
                "exercise_name": str(item.get("exercise_name", "")).strip(),
                "body_part": str(item.get("body_part", "Unknown")).strip() or "Unknown",
                "type": str(item.get("type", "Unknown")).strip() or "Unknown",
                "equipment": str(item.get("equipment", "Unknown")).strip() or "Unknown",
                "difficulty": str(item.get("difficulty", "Unknown")).strip() or "Unknown",
                "met_value": normalize_float(item.get("met_value")),
                "goal_tag": str(item.get("goal_tag", "General")).strip() or "General",
                "sets_recommended": str(item.get("sets_recommended", "")).strip() or None,
                "reps_recommended": str(item.get("reps_recommended", "")).strip() or None,
                "rest_time_sec": normalize_int(item.get("rest_time_sec")),
                "recommended_weight_kg": str(item.get("recommended_weight_kg", "")).strip() or None,
                "video_url": str(item.get("video_url", "")).strip() or None,
                "source_file": str(json_path),
                "source_hash": source_hash,
            }
        )

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.executemany(insert_sql, payloads)
        conn.commit()

    print(f"Imported/updated {len(payloads)} exercise rows into workout_catalog_v2")


if __name__ == "__main__":
    main()
