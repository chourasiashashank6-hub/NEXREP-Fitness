import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cancelSubscriptionApi, fetchPaymentsApi, fetchSubscriptionApi } from "../api/subscriptions";
import type { PaymentRecord, PlanHistoryEntry, Subscription } from "../types/subscription";

interface SubscriptionStore {
  subscription: Subscription | null;
  payments: PaymentRecord[];
  planHistory: PlanHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  fetchSubscription: (userId: string) => Promise<void>;
  fetchPayments: (userId: string) => Promise<void>;
  cancelPlan: (userId: string, subscriptionId: string) => Promise<string | null>;
  reset: () => void;
}

export const useSubscriptionStore = create<SubscriptionStore>()(
  persist(
    (set, get) => ({
      subscription: null,
      payments: [],
      planHistory: [],
      isLoading: false,
      error: null,

      fetchSubscription: async (userId) => {
        set({ isLoading: true, error: null });
        try {
          const data = await fetchSubscriptionApi(userId);
          set({
            subscription: data.subscription,
            planHistory: data.planHistory ?? [],
            isLoading: false,
          });
        } catch {
          set({ error: "Failed to load subscription", isLoading: false });
        }
      },

      fetchPayments: async (userId) => {
        try {
          const data = await fetchPaymentsApi(userId);
          set({ payments: data.payments ?? [] });
        } catch {
          set({ error: "Failed to load payment history" });
        }
      },

      cancelPlan: async (userId, subscriptionId) => {
        try {
          const result = await cancelSubscriptionApi({ userId, subscriptionId });
          set({ subscription: result.subscription });
          await get().fetchSubscription(userId);
          return result.message;
        } catch {
          return null;
        }
      },

      reset: () => set({ subscription: null, payments: [], planHistory: [], error: null }),
    }),
    {
      name: "subscription-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        subscription: state.subscription,
        payments: state.payments,
        planHistory: state.planHistory,
      }),
    },
  ),
);
