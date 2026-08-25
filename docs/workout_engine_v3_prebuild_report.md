# Workout Engine v3 — Pre-Build Report

## 1. Catalog coverage gaps + proposed seed additions

**Critical gap:** Arms × Bodyweight = 1 exercise (Tricep Dips). Shoulders × Bodyweight = 0.

**Proposed additions (seeded before engine ships):**

| Exercise | body_part | equipment | difficulty | is_compound | met |
|---|---|---|---|---|---|
| Close-Grip Push-Up | Arms | Bodyweight | Beginner | false | 4.0 |
| Bodyweight Tricep Extension | Arms | Bodyweight | Beginner | false | 3.5 |
| Archer Push-Up | Arms | Bodyweight | Intermediate | false | 5.0 |
| Pike Push-Up | Shoulders | Bodyweight | Beginner | true | 4.5 |
| Handstand Push-Up | Shoulders | Bodyweight | Advanced | true | 6.0 |
| Wall Walk | Shoulders | Bodyweight | Intermediate | false | 5.0 |
| Scapular Pull-Up | Back | Bodyweight | Beginner | false | 3.5 |
| Superman Hold | Back | Bodyweight | Beginner | false | 3.0 |
| Side Plank | Core | Bodyweight | Beginner | false | 3.0 |
| Cable Woodchop | Core | Cable | Intermediate | true | 4.0 |
| Sumo Squat | Legs | Bodyweight | Beginner | true | 5.0 |
| Hip Thrust | Legs | Bodyweight | Beginner | true | 4.5 |

Thin-pool handling: when cooldown cannot be satisfied, relax cooldown first (meal v3 pattern), then allow compound repeat across week.

## 2. Cue authoring

- Add `cues JSONB` column on `global_exercises` (array of 2–3 strings).
- Author cues for ~90 high-frequency catalog exercises (all compounds + top accessories).
- Pattern fallback map (`press`, `pull`, `hinge`, `squat`, `isolation`, `core`) with 3 variants each.
- Variant index: `sha256(user_id|month|day|exercise_id|version) % len(cues)`.
- Harvest existing PUSH/PULL/LEG pool notes as starting content.

## 3. Problem-area encoding

`PROBLEM_AREA_RULES` maps onboarding problem_area IDs → required movement patterns per week:

| Problem area | Required patterns (min/week) |
|---|---|
| belly_fat, love_handles | core_compound (plank, woodchop, dead bug) |
| skinny_arms | arm_isolation (bicep + tricep) |
| chicken_legs | squat_pattern + hinge_pattern |
| chest_fat | incline_press |
| back_fat | row_pattern |
| rounded_shoulders | rear_delt (face pull) |
| flat_glutes | hip_hinge_thrust |
| arm_flab | tricep_isolation |

Engine boosts/filters exercises tagged via `classify_movement_pattern(exercise)` derived from name + muscles + is_compound.

## 4. Progression model

**Sets/reps axis:** Week 1–2 baseline; week 3+ adds +1 set to primary compound per day (existing behavior).

**Difficulty tier axis:** Month-over-month, `regen_version` increments; engine prefers next difficulty tier exercises where catalog allows (beginner→intermediate at month 2).

**Load axis:** Double progression (section 11). Set increase and load increase do NOT stack same week — load progression checked first; set bump only if weight held.

**Split continuity:** `continue_from_split_key` rotates split template position on month regen (mirrors AI `continue_from_split`).

## 5. Migration plan

1. Deploy engine + migration script.
2. For each user with current-month plan:
   - Days `< from_day` untouched (`from_day = today + 1` if any log exists today, else `today`).
   - Regenerate `from_day..end_of_month` via engine with same focus_muscles.
   - Preserve all `Workout` log rows.
   - Idempotent: skip if `plan.source == 'engine_v3'` and `engine_version` matches.
3. **Today partially logged:** leave today unchanged; start tomorrow.

## 6. Regen limits

Raise defaults: `day_regens_limit=20`, `month_plan_regens_limit=10`. Keep counters for UI badges; no cost basis. Swap limit stays 5/day (abuse guard).

## 7. Weekly volume model

| Goal | Sets/muscle/week target |
|---|---|
| muscle_gain / hypertrophy | 10–16 |
| strength | 8–12 |
| fat_loss / endurance | 8–14 |

Post-build rebalance: if focus muscle < 10 sets, add +1 set to matching exercises; if any muscle > 20, trim isolation sets.

## 8. 1RM estimation (cold-start)

Per-lift bodyweight ratios (male intermediate anchors, female ×0.65):

| Lift family | Beginner | Intermediate | Advanced |
|---|---|---|---|
| Squat | 0.75×BW | 1.0×BW | 1.35×BW |
| Deadlift | 1.0×BW | 1.5×BW | 2.0×BW |
| Bench | 0.5×BW | 0.75×BW | 1.0×BW |
| OHP | 0.35×BW | 0.55×BW | 0.75×BW |
| Row | 0.45×BW | 0.65×BW | 0.85×BW |

Apply goal %1RM by role; round to 2.5 kg barbell / 2 kg dumbbell. UI shows range ±2.5 kg as "starting suggestion".

## 9. Anti-repetition

- Same exercise: never same day; not on consecutive training days.
- Accessories: 4-training-day cooldown within month.
- Compounds: 2-training-day cooldown; repeat allowed if pool < 3.
- Relax cooldown tiers match meal v3.

## 10. Logged performance feedback (v1)

1. `resolve_baseline_load_kg()` for latest logged weight (reuse, no parallel).
2. Epley 1RM from most recent session where reps ≤ 8: `weight × (1 + reps/30)`.
3. Working weight = Epley × role %1RM, rounded.
4. Double progression: if all working sets hit top of rep range → +increment next prescription.
5. Fields: `weight_kg`, `weight_kg_low`, `weight_kg_high`, `weight_change_kg`, `progression_note`.

## 11. Progressive overload UI

- `weight_change_kg > 0` → badge "+2.5 kg from last time"
- Mid-range → optional neutral cue "Same weight — aim for one more rep"
- First prescription → no badge, show weight range only

## 12. Localization

- `split_name` stores i18n key `coach.workout.split.{key}`; mobile calls `t(split_name)` when key matches.
- Cues: English in DB for v1; `cue_i18n_key` optional follow-up. **Explicit v1 regression** for non-English cue text — split names localized.
- `focus_muscles` stay canonical enum strings.

## 13. Equipment + injuries

- **v1:** Assume full gym access. No equipment selector in onboarding today.
- **Injuries:** Not in generation inputs; remain swap-only for v1.

## 14. workout_types

- Engine ignores `workout_types` for v1 (strength selection only).
- Remove from `WORKOUT_SNAPSHOT_FIELDS` staleness check (dead input).

## 15. Dead code removal

Remove after engine ships:
- `_groq_workout_chunk`, `_gemini_workout_chunk`, `_generate_workout_chunk`
- `_regenerate_workout_day_ai`, `_groq_swap_exercise`
- `_fallback_workout_days`, `_fallback_regenerate_exercises`, `_fallback_week_splits` (logic moved to engine)
- `PUSH/PULL/LEG/FULL_BODY/UPPER_EXERCISES` pools (cues harvested first)
- `EXERCISE_ALTERNATIVES`
- `WORKOUT_SYSTEM_PROMPT`, `WORKOUT_REGEN_PROMPT_SUFFIX`, `WORKOUT_DAY_REGEN_SUFFIX`, `WORKOUT_BODY_TYPE_INSTRUCTION`
- AI imports (`log_groq_call`, `log_gemini_call`, `gemini_client`)

**Keep:** `WORKOUT_VOLUME_RULES` text constants (referenced in docs), `get_exercises_per_session`, `_build_workout_ctx`, public API functions.

**Ambiguous — keep:** `_workout_split_instruction` (delete with prompts), `parse_groq_json_array` (used by meal/workout — keep in planner_common).

## Duration formula

`estimated_duration_min = sum(sets × (45s work + rest_seconds)) / 60` — 45s work matches calorie model.
