from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from src.core.config import settings  # noqa: E402


_STRENGTH_EXERCISE_PREFIX_WORDS = {
    "barbell",
    "dumbbell",
    "kettlebell",
    "machine",
    "smith",
    "cable",
    "weighted",
}


@dataclass(frozen=True)
class ExerciseCandidate:
    exercise_id: int
    names: tuple[str, ...]


def _clean_exercise_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_exercise_key(value: Any) -> str:
    return _clean_exercise_name(value).lower()


def _strength_match_key(value: Any) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", _normalize_exercise_key(value))
    tokens = [token for token in cleaned.split() if token not in _STRENGTH_EXERCISE_PREFIX_WORDS]
    return " ".join(tokens)


def _strength_exercises_match(left: Any, right: Any) -> bool:
    a = _strength_match_key(left)
    b = _strength_match_key(right)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _coerce_aliases(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return _coerce_aliases(parsed)
    return []


def load_candidates(conn) -> list[ExerciseCandidate]:
    rows = conn.execute(text("SELECT id, name, aliases FROM global_exercises ORDER BY id")).mappings().all()
    candidates: list[ExerciseCandidate] = []
    for row in rows:
        names = [_clean_exercise_name(row["name"]), *_coerce_aliases(row.get("aliases"))]
        names = [name for name in names if name]
        if names:
            candidates.append(ExerciseCandidate(exercise_id=int(row["id"]), names=tuple(dict.fromkeys(names))))
    return candidates


def resolve_exercise_id(exercise_name: Any, candidates: list[ExerciseCandidate]) -> tuple[int | None, list[ExerciseCandidate]]:
    target_key = _normalize_exercise_key(exercise_name)
    exact_matches = [
        candidate
        for candidate in candidates
        if any(_normalize_exercise_key(candidate_name) == target_key for candidate_name in candidate.names)
    ]
    exact_unique: dict[int, ExerciseCandidate] = {
        candidate.exercise_id: candidate for candidate in exact_matches
    }
    exact_deduped = list(exact_unique.values())
    if len(exact_deduped) == 1:
        return exact_deduped[0].exercise_id, exact_deduped
    if len(exact_deduped) > 1:
        return None, exact_deduped

    matches = [
        candidate
        for candidate in candidates
        if any(_strength_exercises_match(exercise_name, candidate_name) for candidate_name in candidate.names)
    ]
    unique: dict[int, ExerciseCandidate] = {candidate.exercise_id: candidate for candidate in matches}
    deduped = list(unique.values())
    if len(deduped) == 1:
        return deduped[0].exercise_id, deduped
    return None, deduped


def review_event(kind: str, source: str, row_id: Any, exercise_name: Any, matches: list[ExerciseCandidate]) -> dict[str, Any]:
    return {
        "kind": kind,
        "source": source,
        "row_id": row_id,
        "exercise_name": _clean_exercise_name(exercise_name),
        "matches": [
            {"exercise_id": candidate.exercise_id, "names": list(candidate.names)}
            for candidate in matches
        ],
    }


def backfill_table(conn, table_name: str, id_column: str, candidates: list[ExerciseCandidate], *, apply: bool) -> tuple[int, list[dict[str, Any]]]:
    rows = conn.execute(
        text(f"SELECT {id_column} AS row_id, exercise_name FROM {table_name} WHERE exercise_id IS NULL")
    ).mappings().all()
    updated = 0
    review: list[dict[str, Any]] = []
    for row in rows:
        exercise_id, matches = resolve_exercise_id(row["exercise_name"], candidates)
        if exercise_id is None:
            review.append(
                review_event(
                    "ambiguous" if matches else "unmatched",
                    table_name,
                    row["row_id"],
                    row["exercise_name"],
                    matches,
                )
            )
            continue
        if apply:
            conn.execute(
                text(f"UPDATE {table_name} SET exercise_id = :exercise_id WHERE {id_column} = :row_id"),
                {"exercise_id": exercise_id, "row_id": row["row_id"]},
            )
        updated += 1
    return updated, review


def backfill_onboarding(conn, candidates: list[ExerciseCandidate], *, apply: bool) -> tuple[int, list[dict[str, Any]]]:
    rows = conn.execute(
        text("SELECT user_id, onboarding_json FROM user_onboarding")
    ).mappings().all()
    updated = 0
    review: list[dict[str, Any]] = []
    for row in rows:
        onboarding = row["onboarding_json"]
        if isinstance(onboarding, str):
            try:
                onboarding = json.loads(onboarding)
            except json.JSONDecodeError:
                review.append(review_event("invalid_json", "user_onboarding", row["user_id"], "", []))
                continue
        if not isinstance(onboarding, dict):
            continue
        goal = onboarding.get("goal") if isinstance(onboarding.get("goal"), dict) else {}
        target_lifts = goal.get("target_lifts") if isinstance(goal.get("target_lifts"), list) else []
        changed = False
        for index, target in enumerate(target_lifts):
            if not isinstance(target, dict) or target.get("exercise_id") is not None:
                continue
            exercise_name = target.get("exercise_name")
            exercise_id, matches = resolve_exercise_id(exercise_name, candidates)
            if exercise_id is None:
                review.append(
                    review_event(
                        "ambiguous" if matches else "unmatched",
                        "user_onboarding.goal.target_lifts",
                        {"user_id": row["user_id"], "index": index},
                        exercise_name,
                        matches,
                    )
                )
                continue
            target["exercise_id"] = exercise_id
            changed = True
        if changed:
            updated += 1
            if apply:
                conn.execute(
                    text(
                        """
                        UPDATE user_onboarding
                        SET onboarding_json = CAST(:onboarding_json AS JSONB)
                        WHERE user_id = :user_id
                        """
                    ),
                    {"onboarding_json": json.dumps(onboarding), "user_id": row["user_id"]},
                )
    return updated, review


def write_review(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill canonical exercise IDs for logging tables.")
    parser.add_argument("--database-url", default=settings.DATABASE_URL)
    parser.add_argument(
        "--review-log",
        default=str(SERVER_ROOT / "backfill_canonical_logging_ids_review.jsonl"),
        help="JSONL file for ambiguous/unmatched rows.",
    )
    parser.add_argument("--apply", action="store_true", help="Write resolved IDs. Without this flag, dry-run only.")
    args = parser.parse_args()

    engine = create_engine(args.database_url, future=True)
    review_events: list[dict[str, Any]] = []
    with engine.begin() as conn:
        candidates = load_candidates(conn)
        if not candidates:
            raise RuntimeError("No global_exercises candidates found; seed the exercise catalog first.")
        workout_updates, workout_review = backfill_table(conn, "workouts", "id", candidates, apply=args.apply)
        lift_updates, lift_review = backfill_table(conn, "strength_lifts", "id", candidates, apply=args.apply)
        onboarding_updates, onboarding_review = backfill_onboarding(conn, candidates, apply=args.apply)
        review_events.extend(workout_review)
        review_events.extend(lift_review)
        review_events.extend(onboarding_review)

    review_path = Path(args.review_log)
    write_review(review_path, review_events)
    mode = "applied" if args.apply else "dry-run"
    print(
        json.dumps(
            {
                "mode": mode,
                "workouts_resolved": workout_updates,
                "strength_lifts_resolved": lift_updates,
                "onboarding_rows_resolved": onboarding_updates,
                "review_events": len(review_events),
                "review_log": str(review_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
