import { useCallback, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";
import type { MealType } from "../api/caloriesLog";
import { analyzeFoodImageWithGroq, FoodAnalysisResult, FoodScanLimitDetail } from "../services/foodRecognitionService";

export const useFoodRecognition = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitDetail, setLimitDetail] = useState<FoodScanLimitDetail | null>(null);
  const [result, setResult] = useState<FoodAnalysisResult | null>(null);

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const analyzeImage = useCallback(
    async ({
      base64,
      mimeType,
      mealType,
    }: {
      base64: string;
      mimeType?: string;
      mealType?: MealType;
    }):
      | { ok: true; result: FoodAnalysisResult }
      | { ok: false; error: string; limit?: FoodScanLimitDetail | null } => {
      setError(null);
      setLimitDetail(null);
      setIsAnalyzing(true);
      try {
        if (Platform.OS !== "web") {
          const state = await withTimeout(NetInfo.fetch(), 4000, "Network check timed out.");
          if (!state.isConnected || state.isInternetReachable === false) {
            const message = "No internet connection. Please reconnect and try again.";
            setError(message);
            return { ok: false, error: message };
          }
        }

        const response = await withTimeout(
          analyzeFoodImageWithGroq({ base64, mimeType, mealType }),
          35000,
          "Image analysis timed out. Please try again.",
        );
        if ("error" in response) {
          setError(response.error);
          setLimitDetail(response.limit ?? null);
          return { ok: false, error: response.error, limit: response.limit ?? null };
        }
        setResult(response);
        return { ok: true, result: response };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not analyze image right now. Please retry.";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  const resetFoodRecognition = useCallback(() => {
    setError(null);
    setLimitDetail(null);
    setResult(null);
  }, []);

  return useMemo(
    () => ({
      isAnalyzing,
      error,
      limitDetail,
      result,
      analyzeImage,
      resetFoodRecognition,
    }),
    [isAnalyzing, error, limitDetail, result, analyzeImage, resetFoodRecognition],
  );
};
