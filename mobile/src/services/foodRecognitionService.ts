import { apiClient, resolveApiBaseUrl } from "../api/client";
import i18n from "../i18n";
import { normalizeImageBase64Payload } from "../utils/foodImagePayload";

export interface FoodAnalysisResult {
  foodName: string;
  estimatedServingSize: string;
  quantityGrams?: number;
  // Per-100g nutrition values used directly by Add Food form fields.
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fibre: number;
  confidence: "low" | "medium" | "high";
}

export interface FoodAnalysisError {
  error: string;
}

const REQUEST_TIMEOUT_MS = 40_000;

const safeNumber = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 10) / 10);
};

const extractJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(i18n.t("services.food.malformedAi"));
  }
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
    // Supports both:
    // 1) Top-level macros (legacy format)
    // 2) nutritionPer100g object (requested format)
    calories: safeNumber(per100?.calories ?? obj.calories),
    protein: safeNumber(per100?.protein ?? obj.protein),
    carbs: safeNumber(per100?.carbs ?? obj.carbs),
    fats: safeNumber(per100?.fat ?? per100?.fats ?? obj.fat ?? obj.fats),
    fibre: safeNumber(per100?.fibre ?? per100?.fiber ?? obj.fibre ?? obj.fiber),
    confidence,
  };
};

// TODO: route through server — never call AI APIs from mobile (this function uses the server API only).
export const analyzeFoodImageWithGroq = async ({
  base64,
  mimeType,
}: {
  base64: string;
  mimeType?: string;
}): Promise<FoodAnalysisResult | FoodAnalysisError> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const prepared = normalizeImageBase64Payload(base64, mimeType);
    const payload = { base64: prepared.base64, mime_type: prepared.mimeType };
    const origin = resolveApiBaseUrl().replace(/\/+$/, "");
    const prefixes = ["/api/calories", "/v1/calories"];
    let responseData: unknown = null;
    let lastError: unknown = null;

    for (const prefix of prefixes) {
      try {
        const { data } = await apiClient.post(`${origin}${prefix}/foods/analyze-image`, payload, { signal: controller.signal });
        responseData = data;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const status = (error as { response?: { status?: number } })?.response?.status;
        // Only try alternate prefix when route may be missing. For provider 5xx/429
        // errors, repeating the same request doubles quota burn without helping.
        if (status && status !== 404 && status !== 405) {
          break;
        }
      }
    }

    if (responseData == null) {
      const detail =
        (lastError as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        i18n.t("services.food.analyzeFailed");
      return { error: String(detail) };
    }
    return normalizePayload(responseData);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: i18n.t("services.food.timeout") };
    }
    return { error: i18n.t("services.food.analyzeFailed") };
  } finally {
    clearTimeout(timer);
  }
};
