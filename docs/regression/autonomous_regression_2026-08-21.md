# Autonomous Regression Test Pass — 2026-08-21

**Environment:** Expo web `http://localhost:8081/` + local API `http://127.0.0.1:8000`  
**Test account:** `nexrep.prod.test@gmail.com` (NexRep Tester, **Elite** tier, pre-existing state)  
**Constraint:** Observation only — no app code modified during this pass.  
**Total real AI (Groq/Gemini) calls made:** **0**

---

## AI call budget — endpoint inventory

| Action | Endpoint / code path | Still AI-backed? | Used this run |
|--------|----------------------|------------------|---------------|
| Calorie Coach daily insight refresh | `GET /api/calories/coach/insight` → Groq, Gemini fallback | **Yes** (Groq primary) | No |
| Workout Coach insight card | `POST /workout/coach/insight` → Groq, rule fallback | **Yes** (Groq primary) | No |
| Food photo scan | `POST /api/calories/analyze-image` → Groq vision → Gemini → OpenAI | **Yes** | No |
| Workout plan month chunk generation | `workout_planner_service._generate_workout_chunk` → Groq/Gemini | **Yes** (initial plan / month regen) | No |
| Workout single-day regen | `regenerate-day` → `_regenerate_workout_day_ai` | **Yes** | No |
| Meal plan generate / regen / swap / day refresh | `meal_engine_v3_bridge` | **No** (Meal Engine v3, deterministic) | N/A — safe to use freely |
| Coach cadence summaries (Daily/Weekly/Monthly/Yearly views) | `coach_workout_summary_service.py` | **No** (rule-engine) | N/A |
| Pre-workout / Guided Warm-up plan | `generatePreworkoutPlan.ts` | **No** (local catalog + rules) | N/A |
| Planner nutrition extras (if invoked) | `planner_nutrition_extras.py` | **Yes** (Groq) | No |

---

## Automated checks (supplement to manual UI)

| Suite | Result |
|-------|--------|
| `mobile/src/utils/smartReflow.test.ts` | **15/15 pass** — Tier 1/2/3 logic, compound-only, sanitization |
| `mobile/src/utils/sessionMilestoneSlots.test.ts` | **Pass** — planned + extra manual slots |
| `mobile/src/utils/workoutPlannerLog.test.ts` | **Pass** |
| `mobile/src/utils/workoutRestDay.test.ts` | **Pass** |
| `mobile/src/utils/stalePlanDiff.test.ts` | **Pass** |
| `mobile/src/utils/todaysGoalRing.test.ts` | **Pass** |
| `mobile/src/utils/guidedWarmupComplete.test.ts` | **Pass** |
| `mobile/src/utils/generatePreworkoutPlan.test.ts` | **Pass** |
| Other mobile `*.test.ts` (13 files) | **Pass** (2 files exited 0 with no explicit message — calibrationMerge, generatePreworkoutPlan ran clean) |
| `server/tests/test_plan_snapshot.py` | **15/15 pass** |
| `server/tests/test_meal_engine_v3.py` | **2 failed**, 50 passed — `test_import_idempotent`, `test_swap_matches_current_meal_macros` |

---

## Scenario logs

### Scenario 1 — Brand-new user, day 1

**Status:** NOT RUN (requires fresh account + full onboarding reset)

**Reason:** Existing Elite test account already onboarded (goal Fat Loss, plan active since Aug 17). Creating a new user would need signup flow and is out of scope for this session without explicit reset tooling.

---

### Scenario 2 — Consistent user, days 2–7

**Status:** PARTIAL — observed current account state only (not simulated day-by-day)

| Step | Screen | Observed output | Expected? |
|------|--------|-----------------|-----------|
| Open Home | Home | Combined streak **5 days**; calendar Aug 15–21; Mon 17 workout dot; Tue–Fri food dots; Today Fri 21 highlighted | Reasonable for active user |
| Meals milestone | Home | **4/4** — Breakfast/Lunch/Dinner (Meal Planner) + Lunch (Manual) | Matches 4 meals logged today |
| Sessions milestone | Home | **6/6** — Squats, Lunges, Leg Press, Cable Woodchops, Hip Thrusts, **Concentration Curl (Extra)** | Matches planned 5 + 1 manual extra (recent fix) |
| Goal ring | Home | **76%**; to eat **2,312**; to burn **138**; deficit **550**; TDEE **2,939** | Ring math plausible (eat + burn average) |
| Workout KPI sync | Workout Log | Milestone **6 / 5 +1**; KPI **6 exercises**; burn **72 / 138 kcal** | **Consistent with Home** |
| Profile activity | Profile | **2** Day streak; 38 workouts; 605 kcal burned (lifetime) | See gap — streak definition differs from Home |

---

### Scenario 3 — Skip 1–2 days, Tier 1 reflow

**Status:** NOT RUN in UI; **logic verified** via `smartReflow.test.ts`

Unit tests confirm: compound-only redistribution, per-day cap (`REFLOW_MAX_EXERCISES_PER_DAY`), muscle compatibility, acknowledgment ID generation. Full UI popup (“Plan adapted”) not exercised.

---

### Scenario 4 — Skip 5–9 days, Tier 2

**Status:** NOT RUN in UI; **logic verified** via `smartReflow.test.ts` (most-recently-missed-first, unrecovered in weekly review).

---

### Scenario 5 — Skip 10+ days, Tier 3

**Status:** NOT RUN in UI; **logic verified** via `smartReflow.test.ts` + `REFLOW_TIER3_MIN_MISSED_DAYS`. Regenerate-fresh prompt dismiss persistence not UI-tested.

---

### Scenario 6 — Skip entire month / no active plan

**Status:** NOT RUN

---

### Scenario 7 — Rest day (Elite + rest flagged)

**Status:** NOT RUN in UI (today is **Lower A** workout day, not rest). `workoutRestDay.test.ts` passes. Home correctly shows burn card + sessions row today.

---

### Scenario 8 — Mid-month onboarding change → stale banner + Regenerate

**Status:** NOT RUN (did not mutate onboarding fields on live account)

**Note:** Stale-plan handler fixes were implemented this session but not re-validated in this pass.

---

### Scenario 9 — Tier-gated Coach access (Free / Pro / Elite)

**Status:** PARTIAL — only **Elite** account observed

| Step | Screen | Observed output | Expected? |
|------|--------|-----------------|-----------|
| Coach hub | Coach | Both Calorie Coach and Workout Coach cards visible with PRO badges; **Open … →** buttons present (no lock screen) | Elite should have access — OK |
| Dev tier toggle | Settings | Subscriptions shows **ELITE**; dev toggle exists for allowlisted emails | Could not switch to Free/Pro without triggering dev toggle (not exercised to avoid state mutation) |

**NOT TESTED:** Free upsell lock, Pro Daily+Weekly-only vs Elite Monthly/Yearly tabs.

---

### Scenario 10 — Guided Warm-up + main session + refresh hide

**Status:** NOT RUN

Today’s workout already complete; warm-up flow not started. Refresh-count pill visibility on completed day not checked on Workout Planner screen (Planner sub-tab not reachable via web a11y tree in this pass).

---

### Scenario 11 — Bidirectional log sync (planner checkbox ↔ history delete)

**Status:** NOT RUN

| Step | Screen | Observed output | Notes |
|------|--------|-----------------|-------|
| History list | All time history | 6 exercises today; Concentration Curl tagged **Manual log**; planner exercises tagged **Workout Planner** | Sync **to** history appears OK |
| Delete entry | All time history | **No Edit/Delete controls visible** in list rows | Could not test checkbox revert |

---

### Scenario 12 — Meal Planner day-level totals sync

**Status:** PARTIAL

| Source | Values observed |
|--------|-----------------|
| Home “to eat” pill | **2,312** (displays `dailyGoal` / calorie target, not remaining) |
| Calorie Log | **2,477 / 2,312 kcal** consumed; Remaining **-165** |
| Home meals milestone | **4/4** slots filled |
| Calorie Log meal history | **4 today** |

**Assessment:** Consumed total (2,477) vs target (2,312) is internally consistent on Calorie Log. Home “to eat” label shows the **daily target** (2,312), not remaining (-165) — semantic mismatch with Calorie Log “Remaining” row (see Gap Analysis). Meal Planner **Planner** tab daily summary not opened in this pass.

---

### Scenario 13 — Social + profile smoke

**Status:** PARTIAL — smoke only

| Step | Screen | Observed output | Expected? |
|------|--------|-----------------|-----------|
| Social tab | Social | Find people, Search users, Home / Threads / Chats sub-nav render | OK |
| Profile | Profile | ELITE badge, weight journey 10%, season leaderboard #1 You 395 XP | OK |
| Settings | Settings | Subscriptions, Language, Logout, supplement stack, AI calibration links | OK |
| Friend interaction | — | Not attempted | — |

---

### Scenario 14 — Locale switch (Hindi / Hinglish)

**Status:** NOT COMPLETED

Language row tapped in Settings (`Language English ▾`); locale picker selection / reload not confirmed in this pass. Known deferred item: Coach strings may remain English in non-English locales.

---

## Gap analysis

### Broken functionality

| ID | Severity | Scenario | Finding | Regression? |
|----|----------|----------|---------|-------------|
| B1 | Visibly wrong, workaround exists | 12 | Home KPI label **“to eat”** shows **daily calorie target** (2,312), while Calorie Log shows **Remaining -165** after 2,477 consumed. Same word implies remaining budget on one screen and fixed target on another. | Pre-existing UX ambiguity |
| B2 | Visibly wrong, workaround exists | 2 | Home header **“5 days streak”** (combined food+workout via `computeCombinedStreak`) vs Profile Activity **“2 Day streak”** (workout-only consecutive days). Same product uses “streak” for different metrics without disambiguation. | Pre-existing |
| B3 | Blocks automated CI | — | `test_meal_engine_v3.py`: **2 failing tests** (`test_import_idempotent`, `test_swap_matches_current_meal_macros`). | Unknown — env/fixture issue (`ValueError: No ...`) |

### Inconsistencies

| ID | Severity | Screens | Detail |
|----|----------|---------|--------|
| I1 | Cosmetic / UX | Home ↔ Calorie Log | “to eat” semantics (target vs remaining) — see B1 |
| I2 | Cosmetic / UX | Home ↔ Profile | Streak counts 5 vs 2 — see B2 |
| I3 | **Fixed this session** | Home ↔ Workout Log | Session milestone **6/6** with Extra badge aligns with Workout Log **6 / 5 +1** and history count 6 — **no longer inconsistent** (prior 5/15 reflow bug appears resolved) |

### Missing functionality

| ID | Severity | Scenario | Gap |
|----|----------|----------|-----|
| M1 | Cosmetic | 11 | Session history modal shows no per-entry **delete/edit** affordance on web — may be mobile-only or not implemented on web |
| M2 | Info | 9 | No in-app indication on Coach hub that Elite unlocks Monthly/Yearly cadences vs Pro (cards show PRO badge even for Elite user) |

### Degraded / edge-case behavior

| ID | Severity | Scenario | Detail |
|----|----------|----------|--------|
| D1 | Cosmetic | Web | Expo web renders **all tab panels in one scroll stack**; bottom tab switches title/focus but CDP `innerText` includes Home + Workout + Calories + Coach content simultaneously. Deep navigation (e.g. “Open Calorie Coach →”) did not route in web click test — **web may not mirror native navigation fidelity**. |
| D2 | Cosmetic | 12 | User **over target** on calories (-165 remaining); Home goal ring caps at 76% (by design in `todaysGoalRing.ts`) but “to eat” pill still shows full target 2,312 — over-eating state not reflected in Home KPI pill |
| D3 | Info | 14 | Coach + reflow i18n batch still deferred per project history |

### Could NOT be tested

- Full onboarding (Scenario 1)
- Multi-day simulated timelines with state reset (Scenarios 2–6 UI)
- Smart Reflow popup once-only behavior (Scenarios 3–5 UI)
- Rest-day Home layout (Scenario 7)
- Stale plan banner + Regenerate E2E (Scenario 8)
- Free / Pro tier Coach locks (Scenario 9)
- Guided warm-up + refresh pill hide (Scenario 10)
- Planner checkbox revert after history delete (Scenario 11 — blocked by no delete UI)
- Meal Planner daily summary cross-check (Scenario 12 — Planner tab not opened)
- Real payment / Razorpay subscription purchase
- Push notifications, camera scan on device
- Android-specific dev client behaviors
- Any AI-backed refresh (budget intentionally zero)

### Previously known issues — status this run

| Issue | Status in this run |
|-------|-------------------|
| Exercise milestone 5/15 reflow inflation | **Appears fixed** — Workout Log shows 6/5+1 not 15 |
| Extra manual exercise invisible on milestones | **Fixed** — Concentration Curl shows Extra on Home + purple slot on Workout Log |
| Stale plan Regenerate no-op | **Not re-tested** |
| Refresh count pills `Scope · count` | **Not observed** — Coach/planner sub-screens not reached on web |
| Coach non-English strings | **Not verified** — locale switch incomplete |

---

## Summary

- **AI calls used:** 0 / budget-conscious pass
- **Strongest signal:** Core daily logging state for the active test account is **internally consistent** across Home, Workout Log, and session history for today’s workout milestone fix.
- **Top triage items:** (1) clarify Home “to eat” vs remaining calories, (2) align streak labeling Home vs Profile, (3) fix 2 failing meal_engine_v3 server tests, (4) schedule dedicated UI pass for Smart Reflow tiers + stale Regenerate + tier gates on native or improved web navigation.
- **Deliverable:** this file — structured per-scenario log + gap analysis for follow-up fix prompts.

---

# Follow-up Deep Checks — 2026-08-21 (supplement)

**Constraint:** Observation only — **0 app code changes**.  
**AI calls:** **0**  
**Test data mutations:** Controlled meals/workouts added via **local API only** (`REGTEST_*`, `DEEPTEST_*` entries on `127.0.0.1:8000`). Production account observed via Expo web UI only (no production API writes).

**Environment split (important):** Expo web uses `mobile/.env.development` → `https://nexrep-fitness.onrender.com` (production). Local API scripts hit `http://127.0.0.1:8000` (separate DB). UI numbers below are **production** unless labeled **local API**.

---

## Area 1 — Food logging + calorie consistency

### Controlled adds (local API)

| Meal | qty | cal/100g | protein/100g | Expected totals |
|------|-----|----------|--------------|-----------------|
| REGTEST_SNACK_A | 150g | 100 | 10 | 150 kcal, 15g P |
| REGTEST_SNACK_B | 200g | 50 | 20 | 100 kcal, 40g P |
| DEEPTEST_SNACK_C | 50g | 80 | 8 | 40 kcal, 4g P |
| **Sum** | | | | **290 kcal, 59g P** |

After adds, **local API** daily log: **290 kcal**, **59g protein**, **13.5g carbs**, **7.5g fat**, target **2924**, remaining **2634**, **3 meals**.

### Cross-screen matrix — local API (authoritative backend)

| Field | Calorie Log API | Coach nutrition daily | Match? |
|-------|-----------------|----------------------|--------|
| kcal consumed | 290 | 290 | ✅ |
| protein_g | 59 | 59 | ✅ |
| carbs_g | 13.5 | 13.5 | ✅ |
| fat_g | 7.5 | 7.5 | ✅ |
| target_kcal | 2924 | 2924 | ✅ |
| remaining_kcal | 2634 | 2634 | ✅ |
| meals_count | 3 | 3 | ✅ |
| Coach protein-gap note | — | `focusProteinGap` gapG **91** (= 150 − 59) | ✅ math |

Coach updated **immediately** on next `GET /api/coach/summary` — no relogin required.

### Cross-screen matrix — production UI (pre-existing logged day, no new adds)

| Field | Calorie Log UI | Home UI | Meal Planner UI |
|-------|----------------|---------|-----------------|
| kcal consumed | **2477** | (not shown as consumed) | **Not reached** — Meal Planner daily total not opened on web |
| kcal target | **2312** | **“to eat” 2312** | — |
| kcal remaining | **-165** | **not shown** | — |
| protein | **188 / 165g** (over) | — | — |
| carbs | **231 / 246g** | — | — |
| fat | **88 / 73g** (over) | — | — |
| water | **3.3 / 3L** | — | — |
| fibre | **44 / 32g** (over) | — | — |
| meal count | **4 today** | **4/4** milestone | — |

### “To eat” semantics — confirmed bug/UX gap (not two valid metrics)

Code (`HomeScreen.tsx` ~L784) binds **“to eat”** to `dailyGoal` (= `log.target_calories`), **not** `calories_remaining` and **not** consumed.

| Screen | Label | Value shown | Meaning |
|--------|-------|-------------|---------|
| Home | “to eat” | **2312** | Daily calorie **target/budget** |
| Calorie Log | “Remaining” | **-165** | Target minus consumed (over by 165) |
| Calorie Log | headline | **2477 / 2312** | Consumed / target |

**Verdict:** Intentionally different underlying metrics, but **labels do not disambiguate** — a user over target by 165 kcal still sees “to eat 2,312” on Home. **Severity: visibly wrong / confusing** (workaround: use Calorie Log). Matches first-pass finding B1; now confirmed against code.

**Meal Planner daily total:** **NOT TESTED** on production (web navigation opened Workout Planner month view instead of Calorie Planner; meal planner `GET /current` returns **404** on local API — no plan on local DB).

---

## Area 2 — Exercise/workout calorie burn consistency

### Production UI (existing logs + first-pass history data)

| Source | Value | Notes |
|--------|-------|-------|
| Session history (6 entries today) | **11+13+9+15+13+11 = 72 kcal** | Per-entry kcal from first pass |
| Workout Log KPI “kcal burned” | **72** | ✅ matches sum |
| Workout Log “target” KPI | **138** | Matches `goal-progress.exercise_delta_kcal` pattern |
| Workout Log burn progress | **72 / 138 kcal** | ✅ numerator = sum |
| Home “to burn” pill | **138** | Same as **target**, not burned (code: `exerciseDeltaDisplay` from goal-progress) |

**Verdict:** **Actual burn totals are consistent** across history ↔ Workout Log ↔ burn progress bar. Home “to burn” uses the **same misleading pattern as “to eat”** — shows daily burn **target** (138), not actual burned (72). **Severity: UX inconsistency** (parallel to B1).

### Local API controlled adds

| Workout | sets | Per-entry kcal (API) |
|---------|------|---------------------|
| REGTEST_Bicep Curl | 3 | 13 |
| REGTEST_Push-ups | 4 | 44 |
| **Sum** | **7** | **57** |

| Check | Values | Match? |
|-------|--------|--------|
| History kcal sum | 57 | ✅ |
| Coach `completed_sets_today` | 7 | ✅ (= sets sum) |
| Coach tip `tipCloseGap` Chest current/target | **0 / 18** | ⚠️ Sets logged (incl. 4 push-ups) but weekly **Chest volume** still 0 — tip reflects weekly muscle target, not today’s sets. Potentially confusing; not verified as regression of “4 sets hallucination” class |

Guided warm-up burn: **NOT RUN**.

---

## Area 3 — Social tab interaction

### Production UI

| Action | Result |
|--------|--------|
| Social Home | Squad **“Morning Lifters”** 2/6; **NexRep Tester** “Workout + meals done”; **Shashank Chourasia** “Not logged yet” |
| Search “shashank” | **Shashank Chourasia** found; status **Friends**; **Message** button (already connected) |
| Send new friend request | **Skipped** — already friends on production |
| Threads tab | **“No threads to discover”**; public/private discover empty |
| Recent activity feed | **Aug 4** and **Aug 3** streak milestones from Shashank; **no entry for today’s** workout/meal session |
| Weekly leaderboard | **“Invite more friends to unlock the leaderboard”** (only 1 friend in squad context) |
| Profile season leaderboard | **#1 You 395 XP**, **#2 Shashank Chourasia 30 XP** — sensible, not placeholder |

### Local API

| Action | Result |
|--------|--------|
| `POST /api/social/friend-requests` → user 4 | **201 pending_sent** to “shashank” |
| Feed | **empty** |
| Friends list | **empty** (pending not accepted) |
| User search `q=sha` | 3 users returned |

### Untestable without second live account

- Accept/decline incoming request (no second session)
- Private gym thread post/view (no threads exist)
- Confirm activity feed updates in real time after logging (feed empty/stale on production; design may be squad/challenge-driven not per-log)

---

## Area 4 — Coach accuracy vs logged data

### Local API (deterministic coach summaries — no Groq)

After 290 kcal / 59g protein logged:

| Coach claim | Expected | Actual | OK? |
|-------------|----------|--------|-----|
| `daily.calories` | 290 | 290 | ✅ |
| `daily.protein_g` | 59 | 59 | ✅ |
| `macro_status.protein` | low (<80% of 150) | low | ✅ |
| `notes.focusProteinGap.gapG` | 91 | 91 | ✅ |
| `daily.logged` | true | true | ✅ |
| Prompt refresh for update | — | Updated on next GET without manual refresh | ✅ |

### Production UI

| Check | Result |
|-------|--------|
| Open Calorie Coach → Daily view | **BLOCKED on web** — “Open Calorie Coach →” click did not navigate (same D1 web stack issue) |
| Open Workout Coach → Daily view | **BLOCKED on web** |
| Infer from shared API path | `AICalorieCoachScreen` loads same `ensureDailyCalorieLog()` as Calorie Log — with 2477 kcal / 188g protein logged, coach **should** show protein **high** not gap-focused; **cannot confirm rendered UI** |
| Workout Coach weekly volume tips | Visible in API on local; Chest **current: 0** despite logged push-ups — weekly aggregation lag or muscle mapping issue; **needs native UI verification** |

**Overlap with past bugs:** Protein-gap-streak vs actual-logged — **not reproduced on local** (gap math correct). Hallucinated set-count tips — **not reproduced** locally (sets_today matches history); Chest weekly **0** tip may be a different issue.

---

## Follow-up gap analysis (new / upgraded)

| ID | Severity | Area | Finding | Regression? |
|----|----------|------|---------|-------------|
| F1 | **Visibly wrong** | 1 | Home **“to eat”** = calorie **target**; Calorie Log **“Remaining”** = target − consumed. Same concept, opposite labels. Code-confirmed. | Pre-existing UX (upgraded from “ambiguous” to **confirmed by code**) |
| F2 | **Visibly wrong** | 2 | Home **“to burn”** = exercise **target** (138); Workout Log separates **burned 72** vs **target 138**. Parallel to F1. | Pre-existing UX |
| F3 | **Visibly wrong** | 4 | Coach workout `tipCloseGap` shows Chest **current: 0** after logging push-ups (local API). May be correct for **weekly** volume but reads like “you did nothing today.” | Possibly new / needs product clarification |
| F4 | Info | 3 | Activity feed does **not** surface today’s meal/workout logs; only older streak milestones | Unknown if by design |
| F5 | Blocks test | 1 | Meal Planner daily kcal total **not cross-checked** (web nav + local 404) | Test gap |
| F6 | Info | — | **Local vs production DB diverge** for same email — regression scripts on localhost ≠ Expo web UI state | Environment note |

### Code changes this run

**0** (no source files modified).

### AI calls this run

**0**
