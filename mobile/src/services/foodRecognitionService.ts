import axios from "axios";
import { analyzeFoodImage, type MealType } from "../api/caloriesLog";
import i18n from "../i18n";
import { normalizeImageBase64Payload } from "../utils/foodImagePayload";

export interface FoodAnalysisResult {
  foodName: string;
  estimatedServingSize: string;
  quantityGrams?: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fibre: number;
  confidence: "low" | "medium" | "high";
}

export interface FoodAnalysisError {
  error: string;
  limit?: FoodScanLimitDetail;
}

export type FoodScanLimitDetail = {
  code: string;
  limit_type: "daily" | "meal_slot" | "throttle";
  tier: "free" | "pro" | "elite";
  cap: number;
  used: number;
  remaining: number;
  meal_type?: string | null;
  meals_per_day?: number | null;
  resets_at: string;
};

const REQUEST_TIMEOUT_MS = 70_000;

const safeNumber = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 10) / 10);
};

const normalizePayload = (value: unknown): FoodAnalysisResult | FoodAnalysisError => {
  if (!value || typeof value !== "object") {
    return { error: i18n.t("services.food.malformedApi") };
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim()) {
    return { error: obj.error.trim() };
  }

  const confidenceRaw = String(obj.confidence ?? "").toLowerCase();
  const confidence = confidenceRaw === "low" || confidenceRaw === "medium" || confidenceRaw === "high" ? confidenceRaw : "medium";
  const foodName = String(obj.foodName ?? "").trim();
  if (!foodName) {
    return { error: i18n.t("services.food.detectFailed") };
  }
  const per100 =
    obj.nutritionPer100g && typeof obj.nutritionPer100g === "object"
      ? (obj.nutritionPer100g as Record<string, unknown>)
      : null;
  const quantityGrams = safeNumber(
    obj.estimatedServingSizeGrams ??
      obj.quantityGrams ??
      obj.quantity_g ??
      obj.servingSizeGrams ??
      obj.serving_size_g ??
      obj.totalWeightGrams ??
      obj.total_weight_g,
  );

  return {
    foodName,
    estimatedServingSize: String(obj.estimatedServingSize ?? "").trim() || "100g",
    quantityGrams: quantityGrams > 0 ? quantityGrams : undefined,
    calories: safeNumber(per100?.calories ?? obj.calories),
    protein: safeNumber(per100?.protein ?? obj.protein),
    carbs: safeNumber(per100?.carbs ?? obj.carbs),
    fats: safeNumber(per100?.fat ?? per100?.fats ?? obj.fat ?? obj.fats),
    fibre: safeNumber(per100?.fibre ?? per100?.fiber ?? obj.fibre ?? obj.fiber),
    confidence,
  };
};

const parseLimitDetail = (detail: unknown): FoodScanLimitDetail | undefined => {
  if (!detail || typeof detail !== "object") return undefined;
  const row = detail as Record<string, unknown>;
  if (row.code !== "FOOD_SCAN_LIMIT") return undefined;
  return {
    code: String(row.code),
    limit_type: row.limit_type as FoodScanLimitDetail["limit_type"],
    tier: row.tier as FoodScanLimitDetail["tier"],
    cap: Number(row.cap ?? 0),
    used: Number(row.used ?? 0),
    remaining: Number(row.remaining ?? 0),
    meal_type: typeof row.meal_type === "string" ? row.meal_type : null,
    meals_per_day: typeof row.meals_per_day === "number" ? row.meals_per_day : null,
    resets_at: String(row.resets_at ?? ""),
  };
};

const mapAxiosError = (error: unknown): FoodAnalysisError => {
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    const detail = parseLimitDetail(error.response.data?.detail);
    if (detail) {
      return {
        error: i18n.t("services.food.scanLimitReached"),
        limit: detail,
      };
    }
  }
  const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
  if (detail && typeof detail === "object") {
    const limit = parseLimitDetail(detail);
    if (limit) {
      return { error: i18n.t("services.food.scanLimitReached"), limit };
    }
  }
  if (typeof detail === "string" && detail.trim()) {
    return { error: detail.trim() };
  }
  return { error: i18n.t("services.food.analyzeFailed") };
};

export const analyzeFoodImageWithGroq = async ({
  base64,
  mimeType,
  mealType,
}: {
  base64: string;
  mimeType?: string;
  mealType?: MealType;
}): Promise<FoodAnalysisResult | FoodAnalysisError> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const prepared = normalizeImageBase64Payload(base64, mimeType);
    const responseData = await analyzeFoodImage(
      {
        base64: prepared.base64,
        mime_type: prepared.mimeType,
        meal_type: mealType,
      },
      { signal: controller.signal },
    );
    return normalizePayload(responseData);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: i18n.t("services.food.timeout") };
    }
    return mapAxiosError(error);
  } finally {
    clearTimeout(timer);
  }
};
