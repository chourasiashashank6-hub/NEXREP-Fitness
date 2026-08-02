import { apiClient } from "./client";

export type QuoteCategory = "fat_loss" | "muscle_gain" | "strength" | "general";

export type MotivationalQuote = {
  id: number;
  quote: string;
  author: string;
  category: QuoteCategory;
};

export const getRandomQuote = async (category?: Exclude<QuoteCategory, "general">): Promise<MotivationalQuote> => {
  const { data } = await apiClient.get<MotivationalQuote>("/api/quotes/random", {
    params: category ? { category } : undefined,
  });
  return data;
};
