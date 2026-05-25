import type {
  BudgetLevel,
  MealDayPlan,
  MealPlanCurrent,
  MealPlanWeeklyCurrent,
  ProteinSuggestionsResponse,
  SupplementRecommendationsResponse,
  WeeksOverviewResponse,
} from "../types/planner";
import { localDateIso } from "../utils/localDate";
import { apiClient, COACH_API_TIMEOUT_MS } from "./client";

/** Regenerating 15+ days can require several sequential Groq calls. */
const MEAL_REGENERATE_TIMEOUT_MS = 600000;

const params = () => ({ local_date: localDateIso() });

export async function fetchMealPlanCurrent(): Promise<MealPlanCurrent | MealPlanWeeklyCurrent | null> {
  try {
    const { data } = await apiClient.get<MealPlanCurrent | MealPlanWeeklyCurrent>("/api/meal-planner/current", {
      params: params(),
    });
    return data;
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

export async function fetchWeeksOverview(): Promise<WeeksOverviewResponse> {
  const { data } = await apiClient.get<WeeksOverviewResponse>("/api/meal-planner/weeks", { params: params() });
  return data;
}

export async function fetchWeekPlan(weekStartDay: number): Promise<MealPlanCurrent> {
  const { data } = await apiClient.get<MealPlanCurrent>("/api/meal-planner/week", {
    params: { ...params(), week_start_day: weekStartDay },
  });
  return data;
}

export async function generateWeekPlan(budgetLevel: BudgetLevel, weekStartDay: number): Promise<MealPlanCurrent> {
  const { data } = await apiClient.post<MealPlanCurrent>(
    "/api/meal-planner/generate-week",
    { budget_level: budgetLevel, week_start_day: weekStartDay },
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function regenerateWeek(weekStartDay: number, fromDay: number): Promise<MealPlanCurrent> {
  const { data } = await apiClient.post<MealPlanCurrent>(
    "/api/meal-planner/regenerate-week",
    { week_start_day: weekStartDay, from_day: fromDay },
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function generateMealPlan(budgetLevel: BudgetLevel): Promise<MealPlanCurrent> {
  const { data } = await apiClient.post<MealPlanCurrent>(
    "/api/meal-planner/generate",
    { budget_level: budgetLevel },
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function fetchMealPlanDay(day: number): Promise<MealDayPlan> {
  const { data } = await apiClient.get<MealDayPlan>(`/api/meal-planner/day/${day}`, { params: params() });
  return data;
}

export async function deleteMealPlan(): Promise<void> {
  await apiClient.delete("/api/meal-planner/current", { params: params() });
}

export async function regenerateRemainingMeals(fromDay: number): Promise<MealPlanCurrent> {
  const { data } = await apiClient.post<MealPlanCurrent>(
    "/api/meal-planner/regenerate-remaining",
    { from_day: fromDay },
    { params: params(), timeout: MEAL_REGENERATE_TIMEOUT_MS },
  );
  return data;
}

export async function regenerateMealPlanDay(payload: { plan_id: number; day: number }): Promise<MealDayPlan> {
  const { data } = await apiClient.post<MealDayPlan>(
    "/api/meal-planner/regenerate-day",
    payload,
    { params: params(), timeout: COACH_API_TIMEOUT_MS },
  );
  return data;
}

export async function swapMealPlanMeal(payload: {
  plan_id: number;
  day: number;
  meal_type: string;
  reason?: string;
}): Promise<MealDayPlan> {
  const { data } = await apiClient.post<MealDayPlan>("/api/meal-planner/swap-meal", payload, {
    params: params(),
    timeout: COACH_API_TIMEOUT_MS,
  });
  return data;
}

export async function fetchProteinSuggestions(planId: number, day: number): Promise<ProteinSuggestionsResponse> {
  const { data } = await apiClient.get<ProteinSuggestionsResponse>("/api/meal-planner/protein-suggestions", {
    params: { ...params(), plan_id: planId, day },
    timeout: 30_000,
  });
  return data;
}

export async function fetchSupplementRecommendations(): Promise<SupplementRecommendationsResponse> {
  const { data } = await apiClient.get<SupplementRecommendationsResponse>(
    "/api/meal-planner/supplement-recommendations",
    { params: params(), timeout: 15_000 },
  );
  return data;
}
