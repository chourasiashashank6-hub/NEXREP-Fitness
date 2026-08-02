-- One-time backfill: set goal_started_at for existing users missing the field.
-- Safe to re-run (only updates rows where goal_started_at IS NULL).
UPDATE user_onboarding
SET onboarding_json = onboarding_json ||
    jsonb_build_object('goal_started_at', to_char(updated_at, 'YYYY-MM-DD'))
WHERE onboarding_json->>'goal_started_at' IS NULL;
