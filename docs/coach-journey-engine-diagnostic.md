# Coach Journey Engine — Pre-Build Diagnostic

**Generated:** 2026-08-18  
**Scope:** Pre-build verification before specifying the Coach Journey Engine  
**Method:** Codebase inspection (not assumptions)

---

## 1. Event-log architecture — extend or create fresh?

**Recommendation: create a fresh `journey_events` table.**

| Table | Purpose | Key columns |
|---|---|---|
| `activity_events` | Social feed (`ActivityEvent` in `server/src/models/models.py`) | `type` ∈ `{pr, streak_milestone, thread_joined}`, `payload` (JSONB), `visibility`, `deleted_at` |
| `xp_events` | XP ledger (`XpEvent` in `server/src/models/xp.py`) | `event_type`, `xp_amount`, `metadata_json`, `created_at` |

### Why not extend either

- **`activity_events`** — Check-constrained to 3 social types, has `visibility` / `deleted_at` for NexFam feed. Journey patterns (protein gaps, load spikes, disengagement) are internal coaching signals, not shareable feed items.
- **`xp_events`** — Tied to XP amounts and award/reversal semantics (`_award_xp`, `_has_idempotency_key` in `server/src/services/xp_service.py`). Journey events are not XP transactions.

### Proposed schema

Mirrors existing event-log shape (`activity_events` / `xp_events`), with `domain` added for coach routing:

```sql
CREATE TABLE journey_events (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain          VARCHAR(32) NOT NULL,   -- 'nutrition' | 'workout' | 'engagement'
  event_type      VARCHAR(64) NOT NULL,    -- e.g. 'protein_gap_streak', 'load_spike', 'plateau', 'disengagement'
  status          VARCHAR(16) NOT NULL DEFAULT 'active',  -- 'active' | 'resolved'
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
  resolved_at     TIMESTAMPTZ NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX ix_journey_events_user_id ON journey_events(user_id);
CREATE INDEX ix_journey_events_domain ON journey_events(domain);
CREATE INDEX ix_journey_events_event_type ON journey_events(event_type);
CREATE INDEX ix_journey_events_detected_at ON journey_events(detected_at);

CREATE UNIQUE INDEX uq_journey_events_active_pattern
  ON journey_events(user_id, domain, event_type, ((payload_json->>'pattern_key')))
  WHERE status = 'active';
```

`status` + `pattern_key` support idempotency (see section 5).

---

## 2. Reuse canonical computations — don't re-derive them

### Workout domain — Weekly Volume Load

**What the UI actually uses today**

The Weekly Volume Load bars on Workout Coach are **not** powered by a server API call. They come from client-side `buildWorkoutDataFromHistory()` in `mobile/src/screens/Coach/AIWorkoutCoachScreen.tsx`, which:

1. Fetches `getWorkoutHistory(24 * 14)` → `GET /workout/history`
2. Rolls up sets per muscle via `inferMusclesFromWorkout()` (`mobile/src/utils/workoutMuscleInfer.ts`)
3. Gets targets via `getMuscleWeeklyTargets()` / `getTargetWeeklySets()` (`mobile/src/utils/weeklyMuscleTargets.ts`)

**Server-side equivalent (exists but unused by that screen)**

- `GET /workout/coach/data` → `workout_coach_data()` in `server/src/main.py` (~lines 2579–2649)
- Helpers: `_infer_muscles_from_workout()`, `_weekly_target_context()` → `get_muscle_weekly_targets()` / `get_onboarding_weekly_target_inputs()` in `server/src/coach_targets.py`

Both paths use the same **algorithm** (7-day set rollup by muscle group) but are **duplicate implementations** (mobile TS vs server Python).

**For journey engine:** Extract shared logic into one server service (e.g. `coach_volume_service.py`) called by both `workout_coach_data()` and journey detection. Do **not** write a third muscle-volume calculation. Short-term: call the logic inside `workout_coach_data()` directly.

**Note:** Weekly volume is **set counts per muscle**, not tonnage. A “15% load spike” should be defined as set-volume week-over-week unless you add weight-based load separately.

### Nutrition domain

**Canonical target source**

- `get_calorie_log_targets(db, user)` in `server/src/services/calorie_log_targets.py`
- Used by `_get_or_create_daily_log()` in `server/src/routes/calories.py` (lines 1274–1303) — what Calorie Log and Meal Planner share (verified in `server/tests/test_display_targets_consistency.py`)

**Calorie Coach insight path**

- `GET /api/calories/coach/insight` → `coach_calorie_insight()` → `_serialize_day()` → `_get_or_create_daily_log()` → targets from `get_calorie_log_targets`
- Adherence: compare `DailyNutritionLog.total_protein_g` / `total_calories` against `log.target_protein_g` / `log.target_calories` on the daily log row

**For journey engine:** Use `get_calorie_log_targets()` for targets and `DailyNutritionLog` + `MealEntry` for actuals. Do **not** use `resolve_user_targets()` alone — that's macro storage; kcal comes from `compute_user_calorie_plan()` inside `get_calorie_log_targets()`.

---

## 3. Data availability for pattern detection

### Plateau detection (per-exercise working weight)

**Finding: `workouts` table does NOT store weight.**

`Workout` model (`server/src/models/models.py` lines 50–62): `sets`, `reps`, `duration`, `exercise_name`, `notes` — **no `weight_kg`**.

**Where weight exists**

| Source | Table | Weight? | Coverage |
|---|---|---|---|
| Strength logging | `strength_lifts` (`StrengthLift`) | `weight_kg` + `reps` + `date` | Only when user logs via `POST /api/strength/lift` (WorkoutScreen strength flow) |
| Guided sessions | `workout_session_set_logs` (`WorkoutSessionSetLog`) | `weight_kg` nullable per set | Elite guided workouts only |
| Workout history | `workouts` | ❌ | All workouts, but no load data |

**Implication:** Plateau detection on “working weight per exercise” is **only reliable for exercises logged in `strength_lifts`** (goal-target lifts like bench/squat/deadlift via `get_strength_progress()`). Cardio, generic logs, and AI-tracked sessions without strength lift entries **cannot** support weight plateaus as specced. Do not approximate from `workouts.sets` alone.

Historical query for plateaus: `StrengthLift` filtered by `user_id` + `exercise_name`, indexed on `date` and `exercise_name`.

### Load-spike detection (15%+ week-over-week)

**Available data:** Set-volume per muscle from the same rollup as Weekly Volume Load.

**Queryable history**

- `GET /workout/history?range=all&limit=200` — up to 200 rows, no hard date cap when `range=all`
- `GET /workout/coach/data?days=90` — server query up to 90 days
- Mobile coach screen uses 14 days (`getWorkoutHistory(24 * 14)`)

For week-over-week comparison you need ≥14 days of `Workout` rows (`Workout.date` filtered by user). Efficient approach: two 7-day aggregations using existing `_infer_muscles_from_workout()` logic — same as `workout_coach_data()`'s `week_since` window.

**Caveat:** Volume = sets attributed to muscle groups, not weight × reps. Spike detection matches what the coach bars show, not true tonnage.

### Disengagement detection

**Existing patterns to reuse**

| Use case | Function | Location |
|---|---|---|
| Last workout / last meal (cross-domain) | `_last_activity_date()` | `server/src/services/xp_service.py` lines 146–159 |
| Today's workout missing | `_run_missing_log_checks()` | `server/src/services/notification_service.py` lines 356–373 |
| Today's meal missing | `_meal_logged()` + `_run_missing_log_checks()` | same file |
| Days since weigh-in | `get_goal_progress()` | `server/src/routes/calories.py` |
| Last workout label | `workout_coach_data()` / `_relative_label()` | `server/src/main.py` |

For “days since last log per domain,” extend the `_last_activity_date()` pattern with separate queries per domain rather than inventing new ones.

---

## 4. Execution model — on-demand or scheduled?

**Existing job infrastructure**

- `BackgroundScheduler` (APScheduler) in `server/src/services/notification_service.py`
- `start_notification_scheduler()` registered in `server/src/main.py` on app startup
- Cron: `run_hourly_notification_checks` every hour at `:05` UTC
- Smart Reflow compensation runs inside `_run_weekly_digest()` — **Sunday 18:00 UTC** (`now.weekday() != 6 or now.hour != 18`) → `apply_weekly_compensation()` in `plan_reflow_service.py`

**Smart Reflow is hybrid**

- **Scheduled:** Sunday digest + compensation via notification cron
- **On-demand:** `GET /workout-planner/weekly-review` → `build_weekly_review()` (`server/src/routes/workout_planner.py` line 276); reflow patches via `POST /workout-planner/reflow`

**Recommendation: scheduled nightly detection, with on-demand refresh optional**

| Approach | Pros | Cons |
|---|---|---|
| **Scheduled (extend hourly cron)** | No repeated work on every coach screen open; same infra as Smart Reflow/notifications; can batch all users | Slight delay (up to ~24h for daily patterns) |
| **On-demand only** | Always fresh when coach loads | Recomputes on every visit; duplicates Smart Reflow's pattern |

**Concrete plan:** Add `_run_journey_detection(db, user, now)` to `run_hourly_notification_checks()`, gated to a single daily hour (e.g. `now.hour == 3`). Infrastructure already exists — no new scheduler needed. Optionally expose `GET /api/journey/events?domain=...` for coach UI to read precomputed events, with a manual refresh endpoint if needed.

---

## 5. Idempotency

**Existing patterns in codebase**

- `xp_events`: `metadata_json.idempotency_key` + `_has_idempotency_key()` in `server/src/services/xp_service.py` — skip duplicate awards
- Notifications: `NotificationLog.event_key` + `_already_sent()` in `server/src/services/notification_service.py`

**Recommended pattern for journey events: upsert active events, don't create daily duplicates**

For ongoing patterns (e.g. protein gap streak day 4):

1. **One active row per pattern instance** via unique index on `(user_id, domain, event_type, pattern_key) WHERE status = 'active'`
2. **`pattern_key`** in `payload_json` — stable for the streak instance, e.g. `"protein_gap"` or `"protein_gap:2026-08-01"` (streak start date)
3. **On each detection run:**
   - If active event exists → **UPDATE** `payload_json` (e.g. `streak_days: 4`, `last_checked_at`) and `updated_at`
   - If condition cleared → set `status = 'resolved'`, `resolved_at = now()`
   - If condition reappears after resolution → **INSERT** new active event with new `pattern_key`
4. **UI computes "day N"** from `payload_json.streak_started_at` or counts days since first detection — do not insert a new row each day

For one-shot events (e.g. load spike for week 2026-W33):

- Use idempotency key: `load_spike:chest:2026-W33`
- Insert once; subsequent runs skip if row exists (xp-style) or update if spike persists/worsens

**Do not** fire a new `journey_events` row every day for the same active streak.

---

## Summary

| Question | Answer |
|---|---|
| New table? | **Yes** — `journey_events` |
| Workout volume source | **`workout_coach_data()` logic** in `main.py` (consolidate; don't duplicate mobile `buildWorkoutDataFromHistory`) |
| Nutrition targets | **`get_calorie_log_targets()`** + `DailyNutritionLog` actuals |
| Plateau feasible? | **Partially** — only via `strength_lifts` (and optionally `workout_session_set_logs`), not `workouts` |
| Load spike feasible? | **Yes** — set-volume WoW from `Workout` history (14–90 days) |
| Disengagement | **Reuse** `_last_activity_date()` / `_run_missing_log_checks()` patterns |
| Execution | **Scheduled nightly** via existing `run_hourly_notification_checks` |
| Idempotency | **Upsert active events** by `pattern_key`; resolve when cleared; one-shot keys for weekly spikes |

---

## Key file references

| Area | Path |
|---|---|
| Activity events model | `server/src/models/models.py` → `ActivityEvent` |
| XP events model | `server/src/models/xp.py` → `XpEvent` |
| Workout coach data (server) | `server/src/main.py` → `workout_coach_data()`, `_infer_muscles_from_workout()`, `_weekly_target_context()` |
| Workout coach data (mobile) | `mobile/src/screens/Coach/AIWorkoutCoachScreen.tsx` → `buildWorkoutDataFromHistory()` |
| Coach targets | `server/src/coach_targets.py` |
| Calorie targets (canonical) | `server/src/services/calorie_log_targets.py` → `get_calorie_log_targets()` |
| Daily log creation | `server/src/routes/calories.py` → `_get_or_create_daily_log()` |
| Strength lifts | `server/src/models/models.py` → `StrengthLift`; API `POST /api/strength/lift` |
| Smart Reflow / weekly review | `server/src/services/plan_reflow_service.py` → `build_weekly_review()`, `apply_weekly_compensation()` |
| Notification scheduler | `server/src/services/notification_service.py` → `run_hourly_notification_checks()`, `start_notification_scheduler()` |
| XP idempotency | `server/src/services/xp_service.py` → `_has_idempotency_key()`, `_award_xp()` |
| Last activity date | `server/src/services/xp_service.py` → `_last_activity_date()` |

---

## Next steps (not implemented)

1. Alembic migration for `journey_events`
2. `journey_detection_service.py` with detectors for each pattern type
3. Hook into `run_hourly_notification_checks()` at a fixed daily hour
4. `GET /api/journey/events` read endpoint for coach UI
5. Extract shared volume rollup from `workout_coach_data()` into reusable service
