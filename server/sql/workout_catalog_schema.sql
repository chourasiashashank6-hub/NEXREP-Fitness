-- Schema for: /Users/vishay_11/Downloads/Final_281_Exercises .json
-- Records: array of exercise objects
-- Fields:
-- exercise_name, body_part, type, equipment, difficulty, met_value,
-- goal_tag, sets_recommended, reps_recommended, rest_time_sec,
-- recommended_weight_kg, video_url

BEGIN;

CREATE TABLE IF NOT EXISTS workout_catalog_v2 (
  id BIGSERIAL PRIMARY KEY,

  exercise_name TEXT NOT NULL,
  body_part TEXT NOT NULL,
  type TEXT NOT NULL,
  equipment TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  met_value NUMERIC(4,2),
  goal_tag TEXT NOT NULL,
  sets_recommended TEXT,
  reps_recommended TEXT,
  rest_time_sec INTEGER,
  recommended_weight_kg TEXT,
  video_url TEXT,

  -- Optional metadata for future migrations / lineage
  source_file TEXT,
  source_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate logical exercises if same catalog is re-imported
  CONSTRAINT uq_workout_catalog_v2 UNIQUE (
    exercise_name,
    body_part,
    type,
    equipment,
    difficulty,
    goal_tag
  ),

  -- Basic data quality checks
  CONSTRAINT ck_met_value_non_negative CHECK (met_value IS NULL OR met_value >= 0),
  CONSTRAINT ck_rest_time_non_negative CHECK (rest_time_sec IS NULL OR rest_time_sec >= 0)
);

-- Hierarchy/filter indexes for fast dropdown retrieval
CREATE INDEX IF NOT EXISTS idx_wc_v2_type ON workout_catalog_v2 (type);
CREATE INDEX IF NOT EXISTS idx_wc_v2_type_goal ON workout_catalog_v2 (type, goal_tag);
CREATE INDEX IF NOT EXISTS idx_wc_v2_type_goal_difficulty ON workout_catalog_v2 (type, goal_tag, difficulty);
CREATE INDEX IF NOT EXISTS idx_wc_v2_hierarchy_full
  ON workout_catalog_v2 (type, goal_tag, difficulty, exercise_name, equipment);

-- Support common browse/search patterns
CREATE INDEX IF NOT EXISTS idx_wc_v2_body_part ON workout_catalog_v2 (body_part);
CREATE INDEX IF NOT EXISTS idx_wc_v2_exercise_name ON workout_catalog_v2 (exercise_name);

COMMIT;
