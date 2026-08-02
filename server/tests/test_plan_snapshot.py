"""Tests for plan_snapshot.py — staleness detection."""

import json
import pytest

from src.services.plan_snapshot import (
    build_meal_snapshot,
    build_workout_snapshot,
    decode_snapshot,
    encode_snapshot,
    stale_fields,
    stale_meal_fields,
    stale_workout_fields,
)


def make_onboarding(**overrides) -> dict:
    """Minimal valid onboarding dict; override individual sub-fields via dotted keys."""
    base = {
        "personal": {
            "age": 28,
            "biological_sex": "male",
            "height_cm": 175,
            "weight_kg": 75.0,
        },
        "goal": {
            "type": "fat_loss",
            "pace": "moderate",
            "target_weight_kg": 70.0,
            "difficulty": "intermediate",
            "focus_muscles": [],
        },
        "activity": {
            "level": "moderately_active",
            "workouts_per_week": 4,
            "workout_types": ["strength"],
        },
        "dietary": {
            "diet_type": "standard",
            "allergies": [],
            "meals_per_day": 3,
        },
        "body_type": {
            "current_body_id": "average",
            "goal_body_id": "lean",
            "problem_areas": [],
        },
    }
    for k, v in overrides.items():
        section, field = k.split(".", 1)
        base[section][field] = v
    return base


# ---------------------------------------------------------------------------
# Snapshot builders
# ---------------------------------------------------------------------------

class TestBuildMealSnapshot:
    def test_basic(self):
        ob = make_onboarding()
        snap = build_meal_snapshot(ob)
        assert snap["primary_goal"] == "fat_loss"
        assert snap["diet_type"] == "standard"
        assert snap["food_allergies"] == []
        assert snap["daily_activity_level"] == "moderately_active"

    def test_sorted_allergies(self):
        ob = make_onboarding(**{"dietary.allergies": ["nuts", "gluten", "dairy"]})
        snap = build_meal_snapshot(ob)
        assert snap["food_allergies"] == ["dairy", "gluten", "nuts"]


class TestBuildWorkoutSnapshot:
    def test_basic(self):
        ob = make_onboarding()
        snap = build_workout_snapshot(ob)
        assert snap["primary_goal"] == "fat_loss"
        assert snap["difficulty"] == "intermediate"
        assert snap["workouts_per_week"] == 4
        assert snap["workout_types"] == ["strength"]

    def test_sorted_workout_types(self):
        ob = make_onboarding(**{"activity.workout_types": ["yoga", "cardio", "strength"]})
        snap = build_workout_snapshot(ob)
        assert snap["workout_types"] == ["cardio", "strength", "yoga"]


# ---------------------------------------------------------------------------
# Staleness detection
# ---------------------------------------------------------------------------

class TestStaleFields:
    def test_no_drift(self):
        ob = make_onboarding()
        snap = build_meal_snapshot(ob)
        assert stale_fields(snap, snap) == []

    def test_single_field_drifted(self):
        ob = make_onboarding()
        snap = build_meal_snapshot(ob)
        # Mutate current
        ob2 = make_onboarding(**{"dietary.diet_type": "vegan"})
        current = build_meal_snapshot(ob2)
        drifted = stale_fields(snap, current)
        assert "diet_type" in drifted

    def test_no_stored_snapshot_returns_legacy_sentinel(self):
        ob = make_onboarding()
        current = build_meal_snapshot(ob)
        assert stale_fields(None, current) == ["_legacy_no_snapshot"]

    def test_list_order_irrelevant(self):
        ob1 = make_onboarding(**{"dietary.allergies": ["nuts", "gluten"]})
        ob2 = make_onboarding(**{"dietary.allergies": ["gluten", "nuts"]})
        snap = build_meal_snapshot(ob1)
        current = build_meal_snapshot(ob2)
        assert "food_allergies" not in stale_fields(snap, current)

    def test_list_content_differs(self):
        ob1 = make_onboarding(**{"dietary.allergies": ["nuts"]})
        ob2 = make_onboarding(**{"dietary.allergies": ["gluten"]})
        snap = build_meal_snapshot(ob1)
        current = build_meal_snapshot(ob2)
        assert "food_allergies" in stale_fields(snap, current)


# ---------------------------------------------------------------------------
# Prompt spec tests
# ---------------------------------------------------------------------------

class TestSpecBehaviour:
    """Tests mirroring the prompt's spec acceptance criteria."""

    def test_meal_only_field_diet_type(self):
        """Changing diet_type → stale on meal snapshot only, not workout."""
        ob_before = make_onboarding()
        ob_after = make_onboarding(**{"dietary.diet_type": "vegan"})
        meal_snap = encode_snapshot(build_meal_snapshot(ob_before))
        workout_snap = encode_snapshot(build_workout_snapshot(ob_before))

        meal_stale = stale_meal_fields(meal_snap, ob_after)
        workout_stale = stale_workout_fields(workout_snap, ob_after)

        assert "diet_type" in meal_stale
        assert workout_stale == []

    def test_both_planners_primary_goal(self):
        """Changing primary_goal → stale on both meal and workout snapshots."""
        ob_before = make_onboarding()
        ob_after = make_onboarding(**{"goal.type": "muscle_gain"})
        meal_snap = encode_snapshot(build_meal_snapshot(ob_before))
        workout_snap = encode_snapshot(build_workout_snapshot(ob_before))

        meal_stale = stale_meal_fields(meal_snap, ob_after)
        workout_stale = stale_workout_fields(workout_snap, ob_after)

        assert "primary_goal" in meal_stale
        assert "primary_goal" in workout_stale

    def test_unmapped_fields_never_stale(self):
        """Unmapped fields (e.g. name, language) don't appear in either snapshot."""
        ob = make_onboarding()
        meal_snap = encode_snapshot(build_meal_snapshot(ob))
        workout_snap = encode_snapshot(build_workout_snapshot(ob))
        # Even if stored value is different, these fields just don't exist in snapshots
        meal_keys = set(decode_snapshot(meal_snap).keys())
        workout_keys = set(decode_snapshot(workout_snap).keys())
        assert "full_name" not in meal_keys
        assert "full_name" not in workout_keys
        assert "unit_preference" not in meal_keys

    def test_regenerate_later_preserves_stale(self):
        """
        If banner fires and user picks 'later' (snapshot not updated),
        stale check on next load still returns stale.
        """
        ob_before = make_onboarding()
        ob_after = make_onboarding(**{"dietary.diet_type": "vegan"})
        # Stored snapshot is from ob_before; current onboarding is ob_after
        meal_snap = encode_snapshot(build_meal_snapshot(ob_before))
        stale = stale_meal_fields(meal_snap, ob_after)
        # Still stale because snapshot was not updated
        assert "diet_type" in stale

    def test_regenerate_now_clears_stale(self):
        """After regeneration snapshot is written with new values → no stale."""
        ob_after = make_onboarding(**{"dietary.diet_type": "vegan"})
        # Simulate snapshot written at regen time
        new_snap = encode_snapshot(build_meal_snapshot(ob_after))
        stale = stale_meal_fields(new_snap, ob_after)
        assert stale == []

    def test_stale_without_modal_flow(self):
        """
        Staleness detection works even if change bypassed the modal
        (e.g. direct DB update of onboarding). Banner correctness must
        not depend on the modal having fired.
        """
        ob_before = make_onboarding()
        ob_after = make_onboarding(**{"goal.difficulty": "advanced"})
        workout_snap = encode_snapshot(build_workout_snapshot(ob_before))
        # Directly compute staleness without going through any modal flow
        stale = stale_workout_fields(workout_snap, ob_after)
        assert "difficulty" in stale
