import { apiClient, resolveApiBaseUrl } from "./client";

export type MealType = "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Pre_Workout" | "Post_Workout";

export interface CalorieDayPayload {
  date: string;
  macro_split_label: string;
  log: {
    log_id: number;
    user_id: number;
    log_date: string;
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fat_g: number;
    total_fiber_g: number;
    total_water_l: number;
    target_calories: number;
    target_protein_g: number;
    target_carbs_g: number;
    target_fat_g: number;
    target_fiber_g: number;
    target_water_l: number;
    calories_remaining: number;
    is_goal_met: boolean;
  };
  water: { total_water_l: number; target_water_l: number; is_target_met: boolean };
  meals: Array<{
    meal_id: number;
    log_id: number | null;
    meal_type: MealType;
    source_type?: "database" | "camera_ai";
    food_name: string;
    quantity_g: number;
    calories_per_100g: number;
    protein_per_100g: number;
    carbs_per_100g: number;
    fat_per_100g: number;
    fiber_per_100g: number;
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fat_g: number;
    total_fiber_g: number;
    logged_at: string | null;
  }>;
}

export interface FoodSearchItem {
  food_id: number;
  food_name: string;
  category: string;
}

export interface FoodLookupPayload {
  food_id: number;
  food_name: string;
  category: string;
  quantity_g: number;
  per_100g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  };
  scaled: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  };
}

export interface AIFoodMealEntryPayload {
  ai_meal_id: number;
  saved: boolean;
  meal_type: MealType;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  confidence: string;
  estimated_serving_size: string | null;
  created_at: string | null;
  day?: CalorieDayPayload;
}

/** Cached prefix e.g. "/api/calories" after OpenAPI discovery. */
let caloriesRoutePrefix: string | null = null;

/** Call from Calorie Log "Retry" so we re-scan OpenAPI (e.g. after restarting the API). */
export function invalidateCaloriesRoutePrefix() {
  caloriesRoutePrefix = null;
}

function apiOrigin(): string {
  return resolveApiBaseUrl().replace(/\/+$/, "");
}

/**
 * Picks /api/calories vs /v1/calories by reading GET {origin}/openapi.json (no auth).
 * Survives stale proxies and documents which build is running.
 */
async function getCaloriesRoutePrefix(): Promise<string> {
  if (caloriesRoutePrefix) return caloriesRoutePrefix;
  const { data: doc } = await apiClient.get<{ paths?: Record<string, Record<string, unknown>> }>("/openapi.json");
  const paths = doc.paths ?? {};
  for (const prefix of ["/api/calories", "/v1/calories"]) {
    const entry = paths[`${prefix}/daily-log`];
    if (entry && typeof entry === "object" && "post" in entry) {
      caloriesRoutePrefix = prefix;
      return prefix;
    }
  }
  throw new Error(
    "This server has no Calorie Log API (OpenAPI is missing POST …/daily-log). Stop any old process on port 8000, then run uvicorn from folder server with the latest code."
  );
}

async function caloriesAbsUrl(suffix: string): Promise<string> {
  const prefix = await getCaloriesRoutePrefix();
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${apiOrigin()}${prefix}${s}`;
}

export const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const ensureDailyCalorieLog = async (date?: string) => {
  const url = await caloriesAbsUrl("/daily-log");
  const { data } = await apiClient.post<CalorieDayPayload>(url, { date: date ?? null });
  return data;
};

export const getDailyCalorieLog = async (date: string = todayLocal()) => {
  const url = await caloriesAbsUrl(`/daily-log/${encodeURIComponent(date)}`);
  const { data } = await apiClient.get<CalorieDayPayload>(url);
  return data;
};

export const postCalorieMeal = async (payload: {
  log_date?: string;
  meal_type: MealType;
  source_type?: "database" | "camera_ai";
  food_name: string;
  quantity_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number;
}) => {
  const url = await caloriesAbsUrl("/meals");
  const { data } = await apiClient.post<CalorieDayPayload>(url, payload);
  return data;
};

export const deleteCalorieMeal = async (mealId: number) => {
  const url = await caloriesAbsUrl(`/meals/${mealId}`);
  const { data } = await apiClient.delete<CalorieDayPayload>(url);
  return data;
};

export const deleteAIFoodMeal = async (aiMealId: number) => {
  const url = await caloriesAbsUrl(`/foods/ai-meals/${aiMealId}`);
  const { data } = await apiClient.delete<CalorieDayPayload>(url);
  return data;
};

export const patchCalorieMealQty = async (mealId: number, quantityG: number) => {
  const url = await caloriesAbsUrl(`/meals/${mealId}`);
  const { data } = await apiClient.patch<CalorieDayPayload>(url, {
    quantity_g: quantityG,
  });
  return data;
};

export const patchCalorieWater = async (waterL: number, date?: string) => {
  const url = await caloriesAbsUrl("/water");
  const { data } = await apiClient.patch<CalorieDayPayload>(url, {
    water_l: waterL,
    date: date ?? null,
  });
  return data;
};

export const searchFoodCatalog = async (query: string, limit: number = 20) => {
  const url = await caloriesAbsUrl(`/foods/search?q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.min(limit, 50))}`);
  const { data } = await apiClient.get<{ items: FoodSearchItem[] }>(url);
  return data.items ?? [];
};

export const lookupFoodNutrition = async (payload: { food_id?: number; food_name?: string; quantity_g: number }) => {
  const url = await caloriesAbsUrl("/foods/lookup");
  const { data } = await apiClient.post<FoodLookupPayload>(url, payload);
  return data;
};

export const postAIFoodMeal = async (payload: {
  log_date?: string;
  meal_type: MealType;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  confidence?: "low" | "medium" | "high";
  estimated_serving_size?: string;
}) => {
  const url = await caloriesAbsUrl("/foods/ai-meals");
  const { data } = await apiClient.post<AIFoodMealEntryPayload>(url, payload);
  return data;
};
