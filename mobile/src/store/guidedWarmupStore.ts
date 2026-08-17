import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WarmupPhase } from "../utils/generatePreworkoutPlan";

const PREPARING_COUNTDOWN_SEC = 5;

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `warmup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type GuidedWarmupStatus = "preparing" | "active" | "paused" | "completed" | "abandoned";

export interface GuidedWarmupSession {
  session_id: string;
  plan_day_id: string;
  plan_day_number: number;
  day_label: string;
  started_at: string;
  active_started_at: string | null;
  status: GuidedWarmupStatus;
  current_phase_index: number;
  phase_ends_at: string | null;
  preparing_ends_at: string | null;
  paused_at: string | null;
  paused_remaining_sec: number | null;
  phase_actual_durations_sec: number[];
  phases: WarmupPhase[];
  estimated_kcal: number;
  actual_kcal: number | null;
  weight_kg: number;
}

interface GuidedWarmupStore {
  session: GuidedWarmupSession | null;
  startSession: (input: {
    planDayId: string;
    planDayNumber: number;
    dayLabel: string;
    phases: WarmupPhase[];
    estimatedKcal: number;
    weightKg: number;
  }) => void;
  activateFromPreparing: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  advancePhase: () => boolean;
  skipPhase: () => boolean;
  completeSession: (actualKcal?: number) => void;
  abandonSession: () => void;
  clearSession: () => void;
}

function phaseEndsAtFromNow(durationSec: number): string {
  return new Date(Date.now() + durationSec * 1000).toISOString();
}

function currentPhaseRemainingSec(session: GuidedWarmupSession): number {
  if (session.status === "paused") return session.paused_remaining_sec ?? 0;
  if (session.status !== "active" || !session.phase_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(session.phase_ends_at).getTime() - Date.now()) / 1000));
}

function recordCurrentPhaseDuration(session: GuidedWarmupSession): number[] {
  const phase = session.phases[session.current_phase_index];
  if (!phase) return [...session.phase_actual_durations_sec];
  const actual = Math.max(0, phase.duration_sec - currentPhaseRemainingSec(session));
  if (actual <= 0) return [...session.phase_actual_durations_sec];
  return [...session.phase_actual_durations_sec, actual];
}

export const useGuidedWarmupStore = create<GuidedWarmupStore>()(
  persist(
    (set, get) => ({
      session: null,

      startSession: ({ planDayId, planDayNumber, dayLabel, phases, estimatedKcal, weightKg }) => {
        const first = phases[0];
        if (!first) return;
        set({
          session: {
            session_id: newSessionId(),
            plan_day_id: planDayId,
            plan_day_number: planDayNumber,
            day_label: dayLabel,
            started_at: new Date().toISOString(),
            active_started_at: null,
            status: "preparing",
            current_phase_index: 0,
            phase_ends_at: null,
            preparing_ends_at: phaseEndsAtFromNow(PREPARING_COUNTDOWN_SEC),
            paused_at: null,
            paused_remaining_sec: null,
            phase_actual_durations_sec: [],
            phases,
            estimated_kcal: estimatedKcal,
            actual_kcal: null,
            weight_kg: weightKg,
          },
        });
      },

      activateFromPreparing: () =>
        set((state) => {
          const session = state.session;
          if (!session || session.status !== "preparing") return state;
          const first = session.phases[0];
          if (!first) return state;
          return {
            session: {
              ...session,
              status: "active",
              active_started_at: new Date().toISOString(),
              preparing_ends_at: null,
              phase_ends_at: phaseEndsAtFromNow(first.duration_sec),
            },
          };
        }),

      pauseSession: () =>
        set((state) => {
          const session = state.session;
          if (!session || session.status !== "active") return state;
          const remaining = currentPhaseRemainingSec(session);
          return {
            session: {
              ...session,
              status: "paused",
              paused_at: new Date().toISOString(),
              paused_remaining_sec: remaining,
            },
          };
        }),

      resumeSession: () =>
        set((state) => {
          const session = state.session;
          if (!session || session.status !== "paused") return state;
          const remaining = session.paused_remaining_sec ?? 0;
          return {
            session: {
              ...session,
              status: "active",
              paused_at: null,
              paused_remaining_sec: null,
              phase_ends_at: phaseEndsAtFromNow(remaining),
            },
          };
        }),

      advancePhase: () => {
        const session = get().session;
        if (!session || session.status === "completed" || session.status === "abandoned") return false;
        if (session.status === "preparing") return false;

        const completedDurations = recordCurrentPhaseDuration(session);
        const nextIndex = session.current_phase_index + 1;
        if (nextIndex >= session.phases.length) {
          set({
            session: {
              ...session,
              status: "completed",
              current_phase_index: session.phases.length - 1,
              phase_ends_at: null,
              paused_at: null,
              paused_remaining_sec: null,
              phase_actual_durations_sec: completedDurations,
            },
          });
          return false;
        }

        const nextPhase = session.phases[nextIndex];
        set({
          session: {
            ...session,
            status: "active",
            current_phase_index: nextIndex,
            phase_ends_at: phaseEndsAtFromNow(nextPhase.duration_sec),
            paused_at: null,
            paused_remaining_sec: null,
            phase_actual_durations_sec: completedDurations,
          },
        });
        return true;
      },

      skipPhase: () => get().advancePhase(),

      completeSession: (actualKcal) =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              status: "completed",
              actual_kcal: actualKcal ?? state.session.actual_kcal,
            },
          };
        }),

      abandonSession: () =>
        set((state) => {
          if (!state.session) return state;
          return { session: { ...state.session, status: "abandoned" } };
        }),

      clearSession: () => set({ session: null }),
    }),
    {
      name: "guided-warmup-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ session: state.session }),
    },
  ),
);

export function getPreparingRemainingSec(session: GuidedWarmupSession | null): number {
  if (!session || session.status !== "preparing" || !session.preparing_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(session.preparing_ends_at).getTime() - Date.now()) / 1000));
}

export function getPhaseRemainingSec(session: GuidedWarmupSession | null): number {
  if (!session) return 0;
  if (session.status === "preparing") return getPreparingRemainingSec(session);
  if (session.status === "paused") return session.paused_remaining_sec ?? 0;
  if (session.status !== "active") return 0;
  if (!session.phase_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(session.phase_ends_at).getTime() - Date.now()) / 1000));
}

export function getSessionElapsedSec(session: GuidedWarmupSession | null): number {
  if (!session) return 0;
  if (session.status === "preparing" || !session.active_started_at) return 0;
  const startMs = new Date(session.active_started_at).getTime();
  let elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  if (session.status === "paused" && session.paused_at) {
    const pausedFor = Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000));
    elapsed -= pausedFor;
  }
  return Math.max(0, elapsed);
}
