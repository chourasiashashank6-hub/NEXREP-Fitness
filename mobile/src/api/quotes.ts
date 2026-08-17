import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayLocal } from "./caloriesLog";
import { apiClient } from "./client";

export type QuoteCategory = "fat_loss" | "muscle_gain" | "strength" | "general";

export type MotivationalQuote = {
  id: number;
  quote: string;
  author: string;
  category: QuoteCategory;
};

const dailyQuoteCache = new Map<string, MotivationalQuote>();
const STORAGE_PREFIX = "daily-quote-v1:";

function dailyQuoteCacheKey(category: Exclude<QuoteCategory, "general"> | undefined, localDate: string) {
  return `${localDate}:${category ?? "general"}`;
}

async function readStoredDailyQuote(cacheKey: string, localDate: string): Promise<MotivationalQuote | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { localDate: string; quote: MotivationalQuote };
    if (parsed.localDate !== localDate || !parsed.quote?.quote) return null;
    return parsed.quote;
  } catch {
    return null;
  }
}

async function writeStoredDailyQuote(cacheKey: string, localDate: string, quote: MotivationalQuote): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + cacheKey, JSON.stringify({ localDate, quote }));
  } catch {
    /* non-fatal */
  }
}

export const getRandomQuote = async (category?: Exclude<QuoteCategory, "general">): Promise<MotivationalQuote> => {
  const { data } = await apiClient.get<MotivationalQuote>("/api/quotes/random", {
    params: category ? { category } : undefined,
  });
  if (!data?.quote?.trim()) {
    throw new Error("Quote payload missing text");
  }
  return data;
};

function isValidQuote(data: unknown): data is MotivationalQuote {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as MotivationalQuote).quote === "string" &&
    (data as MotivationalQuote).quote.trim().length > 0
  );
}

export const getDailyQuote = async (
  category?: Exclude<QuoteCategory, "general">,
  localDate: string = todayLocal(),
): Promise<MotivationalQuote> => {
  const cacheKey = dailyQuoteCacheKey(category, localDate);
  const cached = dailyQuoteCache.get(cacheKey);
  if (cached) return cached;

  const stored = await readStoredDailyQuote(cacheKey, localDate);
  if (stored) {
    dailyQuoteCache.set(cacheKey, stored);
    return stored;
  }

  let quote: MotivationalQuote;
  try {
    const { data } = await apiClient.get<MotivationalQuote>("/api/quotes/daily", {
      params: {
        ...(category ? { category } : {}),
        local_date: localDate,
      },
    });
    if (!isValidQuote(data)) {
      throw new Error("Daily quote payload missing text");
    }
    quote = data;
  } catch {
    // Older servers may not expose /daily yet — pick once and cache for the rest of the day.
    quote = await getRandomQuote(category);
  }

  dailyQuoteCache.set(cacheKey, quote);
  await writeStoredDailyQuote(cacheKey, localDate, quote);
  return quote;
};
