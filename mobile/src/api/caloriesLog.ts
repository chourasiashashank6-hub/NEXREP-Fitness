import axios from "axios";
import { apiClient } from "./client";

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
    source_type?: "database" | "camera_ai" | "meal_planner";
    food_id?: number | null;
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

export type CalorieMealHistoryItem = CalorieDayPayload["meals"][number] & {
  date: string;
};

export type CalorieMealDayTotal = {
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_fiber_g: number;
};

export interface CalorieMealHistoryResponse {
  items: CalorieMealHistoryItem[];
  dayTotals: Record<string, CalorieMealDayTotal>;
  total: number;
  limit: number;
  offset: number;
  summary: {
    totalMealsLogged: number;
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    totalFiber: number;
  };
}

export interface FoodSearchItem {
  food_id: number;
  food_name: string;
  default_food_name?: string;
  category: string;
  default_category?: string;
}

export interface FoodLookupPayload {
  food_id: number;
  food_name: string;
  default_food_name?: string;
  category: string;
  default_category?: string;
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

const CALORIES_PREFIXES = ["/api/calories", "/v1/calories"] as const;

/** Cached prefix e.g. "/api/calories" after a successful call. */
let caloriesRoutePrefix: (typeof CALORIES_PREFIXES)[number] | null = null;

/** Call from Calorie Log "Retry" so we re-probe routes (e.g. after restarting the API). */
export function invalidateCaloriesRoutePrefix() {
  caloriesRoutePrefix = null;
}

async function discoverPrefixFromOpenApi(): Promise<(typeof CALORIES_PREFIXES)[number] | null> {
  try {
    const { data: doc } = await apiClient.get<{ paths?: Record<string, Record<string, unknown>> }>("/openapi.json");
    const paths = doc.paths ?? {};
    for (const prefix of CALORIES_PREFIXES) {
      const entry = paths[`${prefix}/daily-log`];
      if (entry && typeof entry === "object" && "post" in entry) {
        return prefix;
      }
    }
  } catch {
    // OpenAPI probe failed — fall back to trying both prefixes on requests.
  }
  return null;
}

async function prefixCandidates(): Promise<(typeof CALORIES_PREFIXES)[number][]> {
  if (caloriesRoutePrefix) return [caloriesRoutePrefix, ...CALORIES_PREFIXES.filter((p) => p !== caloriesRoutePrefix)];
  const discovered = await discoverPrefixFromOpenApi();
  if (discovered) {
    caloriesRoutePrefix = discovered;
    return [discovered, ...CALORIES_PREFIXES.filter((p) => p !== discovered)];
  }
  return [...CALORIES_PREFIXES];
}

function joinPath(prefix: string, suffix: string): string {
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${prefix}${s}`;
}

async function withCaloriesRoute<T>(
  suffix: string,
  request: (path: string) => Promise<T>,
): Promise<T> {
  const prefixes = await prefixCandidates();
  let lastError: unknown;
  for (const prefix of prefixes) {
    try {
      const result = await request(joinPath(prefix, suffix));
      caloriesRoutePrefix = prefix;
      return result;
    } catch (error) {
      lastError = error;
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        caloriesRoutePrefix = null;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("Calorie Log API not found on this server.");
}

export const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const ensureDailyCalorieLog = async (date?: string) => {
  return withCaloriesRoute("/daily-log", async (path) => {
    const { data } = await apiClient.post<CalorieDayPayload>(path, { date: date ?? null });
    return data;
  });
};

export const getDailyCalorieLog = async (date: string = todayLocal()) => {
  return withCaloriesRoute(`/daily-log/${encodeURIComponent(date)}`, async (path) => {
    const { data } = await apiClient.get<CalorieDayPayload>(path);
    return data;
  });
};

export interface CalorieStreakResponse {
  days: Array<{ date: string; total_calories: number }>;
  start_date: string;
  end_date: string;
  current_streak?: number;
  personal_best_streak?: number;
}

/**
 * Bulk-fetch `total_calories` for the last `days` calendar days ending on `endDate`
 * (defaults to today) in a single request — replaces looping `getDailyCalorieLog(date)`
 * once per day, which previously fired one request per day (e.g. 59 for a 60-day streak).
 */
export const getCalorieStreak = async (days: number, endDate: string = todayLocal()) => {
  return withCaloriesRoute("/streak", async (path) => {
    const { data } = await apiClient.get<CalorieStreakResponse>(path, {
      params: { days, end_date: endDate },
    });
    return data;
  });
};

export const getCalorieMealHistory = async (params: {
  range?: "today" | "all";
  limit?: number;
  offset?: number;
  search?: string;
}) => {
  const query = new URLSearchParams();
  query.set("range", params.range ?? "all");
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  if (params.search?.trim()) query.set("search", params.search.trim());
  return withCaloriesRoute(`/daily-log?${query.toString()}`, async (path) => {
    const { data } = await apiClient.get<CalorieMealHistoryResponse>(path);
    return data;
  });
};

export const postCalorieMeal = async (payload: {
  log_date?: string;
  meal_type: MealType;
  source_type?: "database" | "camera_ai" | "meal_planner";
  food_id?: number | null;
  food_name: string;
  quantity_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number;
}) => {
  return withCaloriesRoute("/meals", async (path) => {
    const { data } = await apiClient.post<CalorieDayPayload>(path, payload);
    return data;
  });
};

export const deleteCalorieMeal = async (mealId: number) => {
  return withCaloriesRoute(`/meals/${mealId}`, async (path) => {
    const { data } = await apiClient.delete<CalorieDayPayload>(path);
    return data;
  });
};

export const deleteAIFoodMeal = async (aiMealId: number) => {
  return withCaloriesRoute(`/foods/ai-meals/${aiMealId}`, async (path) => {
    const { data } = await apiClient.delete<CalorieDayPayload>(path);
    return data;
  });
};

export const patchCalorieMealQty = async (mealId: number, quantityG: number) => {
  return withCaloriesRoute(`/meals/${mealId}`, async (path) => {
    const { data } = await apiClient.patch<CalorieDayPayload>(path, { quantity_g: quantityG });
    return data;
  });
};

export const patchCalorieWater = async (waterL: number, date?: string) => {
  return withCaloriesRoute("/water", async (path) => {
    const { data } = await apiClient.patch<CalorieDayPayload>(path, {
      water_l: waterL,
      date: date ?? null,
    });
    return data;
  });
};

export const searchFoodCatalog = async (query: string, limit: number = 20, language?: string | null) => {
  const q = encodeURIComponent(query);
  const lim = Math.max(1, Math.min(limit, 50));
  const lang = language ? `&language=${encodeURIComponent(language)}` : "";
  return withCaloriesRoute(`/foods/search?q=${q}&limit=${lim}${lang}`, async (path) => {
    const { data } = await apiClient.get<{ items: FoodSearchItem[] }>(path);
    return data.items ?? [];
  });
};

export const lookupFoodNutrition = async (payload: { food_id?: number; food_name?: string; quantity_g: number; language?: string | null }) => {
  return withCaloriesRoute("/foods/lookup", async (path) => {
    const { data } = await apiClient.post<FoodLookupPayload>(path, payload);
    return data;
  });
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
  return withCaloriesRoute("/foods/ai-meals", async (path) => {
    const { data } = await apiClient.post<AIFoodMealEntryPayload>(path, payload);
    return data;
  });
};
