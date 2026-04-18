-- PostgreSQL DDL for calorie log feature (IF NOT EXISTS).
-- FK user_id references public.users(id).

CREATE TABLE IF NOT EXISTS daily_nutrition_logs (
  log_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  total_calories NUMERIC(7,2) DEFAULT 0.00,
  total_protein_g NUMERIC(6,2) DEFAULT 0.00,
  total_carbs_g NUMERIC(6,2) DEFAULT 0.00,
  total_fat_g NUMERIC(6,2) DEFAULT 0.00,
  total_water_l NUMERIC(4,2) DEFAULT 0.00,
  target_calories INTEGER DEFAULT 2100,
  target_protein_g NUMERIC(6,2) DEFAULT 158.00,
  target_carbs_g NUMERIC(6,2) DEFAULT 210.00,
  target_fat_g NUMERIC(6,2) DEFAULT 70.00,
  target_water_l NUMERIC(4,2) DEFAULT 2.50,
  calories_remaining NUMERIC(7,2) DEFAULT 0.00,
  is_goal_met BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, log_date)
);

CREATE TABLE IF NOT EXISTS meal_entries (
  meal_id SERIAL PRIMARY KEY,
  log_id INTEGER NOT NULL REFERENCES daily_nutrition_logs(log_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_type VARCHAR(32) NOT NULL
    CHECK (meal_type IN (
      'Breakfast','Lunch','Dinner','Snack','Pre_Workout','Post_Workout'
    )),
  food_name VARCHAR(200) NOT NULL,
  quantity_g NUMERIC(8,2) NOT NULL,
  calories_per_100g NUMERIC(7,2) NOT NULL,
  protein_per_100g NUMERIC(6,2) DEFAULT 0.00,
  carbs_per_100g NUMERIC(6,2) DEFAULT 0.00,
  fat_per_100g NUMERIC(6,2) DEFAULT 0.00,
  total_calories NUMERIC(7,2) NOT NULL,
  total_protein_g NUMERIC(6,2) DEFAULT 0.00,
  total_carbs_g NUMERIC(6,2) DEFAULT 0.00,
  total_fat_g NUMERIC(6,2) DEFAULT 0.00,
  logged_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS water_intake_log (
  water_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  total_water_l NUMERIC(4,2) DEFAULT 0.00,
  target_water_l NUMERIC(4,2) DEFAULT 2.50,
  is_target_met BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, log_date)
);
