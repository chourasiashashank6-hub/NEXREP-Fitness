import { useCallback, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";
import { analyzeFoodImageWithGroq, FoodAnalysisResult } from "../services/foodRecognitionService";

export const useFoodRecognition = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const analyzeImage = useCallback(async ({ base64, mimeType }: { base64: string; mimeType?: string }) => {
    setError(null);
    setIsAnalyzing(true);
    try {
      if (Platform.OS !== "web") {
        const state = await withTimeout(NetInfo.fetch(), 4000, "Network check timed out.");
        if (!state.isConnected || state.isInternetReachable === false) {
          const message = "No internet connection. Please reconnect and try again.";
          setError(message);
          return null;
        }
      }

      const response = await withTimeout(
        analyzeFoodImageWithGroq({ base64, mimeType }),
        35000,
        "Image analysis timed out. Please try again.",
      );
      if ("error" in response) {
        setError(response.error);
        return null;
      }
      setResult(response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not analyze image right now. Please retry.";
      setError(message);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const resetFoodRecognition = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return useMemo(
    () => ({
      isAnalyzing,
      error,
      result,
      analyzeImage,
      resetFoodRecognition,
    }),
    [isAnalyzing, error, result, analyzeImage, resetFoodRecognition],
  );
};
