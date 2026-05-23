-- Global exercise reference table (searchable exercise universe)
BEGIN;

CREATE TABLE IF NOT EXISTS global_exercises (
  id                  BIGSERIAL PRIMARY KEY,
  name                TEXT        NOT NULL,
  aliases             TEXT[]      DEFAULT '{}',
  body_part           TEXT        NOT NULL,
  category            TEXT        NOT NULL,
  equipment           TEXT        NOT NULL,
  muscles_primary     TEXT[]      DEFAULT '{}',
  muscles_secondary   TEXT[]      DEFAULT '{}',
  met_value           NUMERIC(4,1) DEFAULT 4.0,
  difficulty          TEXT        CHECK (difficulty IN ('Beginner','Intermediate','Advanced')),
  is_compound         BOOLEAN     DEFAULT false,
  catalog_id          BIGINT      REFERENCES workout_catalog_v2(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_exercises_name ON global_exercises (name);
CREATE INDEX IF NOT EXISTS idx_global_exercises_body_part ON global_exercises (body_part);
CREATE INDEX IF NOT EXISTS idx_global_exercises_catalog_id ON global_exercises (catalog_id);

COMMIT;
