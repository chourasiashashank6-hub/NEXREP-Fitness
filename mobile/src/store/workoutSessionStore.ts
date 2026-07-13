import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SessionType = "standard" | "ai_camera";
export type TrackingMethod = "manual" | "ai_camera";
export type AiCameraUiPhase = "tracking" | "rest" | "exercise_complete" | "manual_fallback";
export type FormStatus = "good" | "correction" | "unknown";

// exercise_name is used as the identifier because WorkoutExercise has no id field
export interface SetLog {
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number | null;
  started_at: string;
  completed_at: string;
  kcal: number;
  tracking_method: TrackingMethod;
  form_quality_pct?: number | null;
}

export interface SessionExercise {
  exercise_name: string;
  muscle: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  met_value: number;
}

export interface WorkoutSession {
  session_id: string;
  plan_day_id: string;
  plan_day_number: number;
  day_name: string;
  started_at: string;
  status: "active" | "resting" | "completed" | "abandoned";
  current_exercise_index: number;
  current_set: number;
  rest_ends_at: string | null;
  /**
   * Duration used for the rest countdown ring (this rest period only).
   * Adjusted when the user taps +15s during rest; does not change exercise.rest_seconds.
   */
  rest_ring_total_sec: number | null;
  exercises: SessionExercise[];
  set_logs: SetLog[];
  session_type: SessionType;
  /** AI camera–only UI phase (ignored for standard sessions). */
  ai_ui_phase: AiCameraUiPhase;
  current_rep_count: number;
  form_status: FormStatus;
  last_correction: string | null;
  audio_guidance_enabled: boolean;
  form_good_samples: number;
  form_total_samples: number;
  exercise_checkpoint_at: string | null;
}

interface WorkoutSessionStore {
  session: WorkoutSession | null;
  startSession: (
    planDayId: string,
    planDayNumber: number,
    dayName: string,
    exercises: SessionExercise[],
    sessionType?: SessionType,
  ) => void;
  logSet: (log: Omit<SetLog, "set_number">) => void;
  beginRest: (restSeconds: number) => void;
  endRest: () => void;
  /**
   * Shift this rest period's end time by deltaSeconds.
   * Clamps remaining to [0, 300]. Returns true when remaining hits 0 (caller should finish rest).
   */
  adjustRestRemaining: (deltaSeconds: number) => boolean;
  advanceExercise: () => void;
  completeSession: () => void;
  abandonSession: () => void;
  clearSession: () => void;
  setAiUiPhase: (phase: AiCameraUiPhase) => void;
  setCurrentRepCount: (reps: number) => void;
  resetRepTracking: () => void;
  updateFormTracking: (status: FormStatus, correction?: string | null) => void;
  setAudioGuidanceEnabled: (enabled: boolean) => void;
  markExerciseCheckpoint: () => void;
  clearExerciseCheckpoint: () => void;
}

const defaultAiFields = (sessionType: SessionType) => ({
  session_type: sessionType,
  ai_ui_phase: (sessionType === "ai_camera" ? "tracking" : "tracking") as AiCameraUiPhase,
  current_rep_count: 0,
  form_status: "unknown" as FormStatus,
  last_correction: null as string | null,
  audio_guidance_enabled: true,
  form_good_samples: 0,
  form_total_samples: 0,
  exercise_checkpoint_at: null as string | null,
});

export const useWorkoutSessionStore = create<WorkoutSessionStore>()(
  persist(
    (set) => ({
      session: null,

      startSession: (planDayId, planDayNumber, dayName, exercises, sessionType = "standard") =>
        set({
          session: {
            session_id: newSessionId(),
            plan_day_id: planDayId,
            plan_day_number: planDayNumber,
            day_name: dayName,
            started_at: new Date().toISOString(),
            status: "active",
            current_exercise_index: 0,
            current_set: 1,
            rest_ends_at: null,
            rest_ring_total_sec: null,
            exercises,
            set_logs: [],
            ...defaultAiFields(sessionType),
            ai_ui_phase: sessionType === "ai_camera" ? "tracking" : "tracking",
          },
        }),

      logSet: (log) =>
        set((state) => {
          if (!state.session) return state;
          const set_number = state.session.current_set;
          return {
            session: {
              ...state.session,
              set_logs: [
                ...state.session.set_logs,
                {
                  form_quality_pct: null,
                  ...log,
                  set_number,
                  tracking_method: log.tracking_method ?? "manual",
                },
              ],
            },
          };
        }),

      beginRest: (restSeconds) =>
        set((state) => {
          if (!state.session) return state;
          const secs = Math.max(0, Math.round(restSeconds));
          return {
            session: {
              ...state.session,
              status: "resting",
              rest_ends_at: new Date(Date.now() + secs * 1000).toISOString(),
              rest_ring_total_sec: Math.max(1, secs),
              ai_ui_phase:
                state.session.session_type === "ai_camera" ? "rest" : state.session.ai_ui_phase,
            },
          };
        }),

      endRest: () =>
        set((state) => {
          if (!state.session) return state;
          const nextType = state.session.session_type;
          return {
            session: {
              ...state.session,
              status: "active",
              rest_ends_at: null,
              rest_ring_total_sec: null,
              current_set: state.session.current_set + 1,
              current_rep_count: 0,
              form_status: "unknown",
              last_correction: null,
              form_good_samples: 0,
              form_total_samples: 0,
              ai_ui_phase: nextType === "ai_camera" ? "tracking" : state.session.ai_ui_phase,
            },
          };
        }),

      adjustRestRemaining: (deltaSeconds) => {
        let shouldComplete = false;
        set((state) => {
          if (!state.session || state.session.status !== "resting" || !state.session.rest_ends_at) {
            return state;
          }
          const now = Date.now();
          const currentEnds = new Date(state.session.rest_ends_at).getTime();
          const remainingSec = Math.max(0, (currentEnds - now) / 1000);
          const nextRemaining = Math.min(300, Math.max(0, remainingSec + deltaSeconds));
          if (nextRemaining <= 0) {
            shouldComplete = true;
            return state; // finishRest will call endRest
          }
          const ringTotal = Math.max(
            state.session.rest_ring_total_sec ?? remainingSec,
            nextRemaining,
            1,
          );
          return {
            session: {
              ...state.session,
              rest_ends_at: new Date(now + nextRemaining * 1000).toISOString(),
              rest_ring_total_sec: ringTotal,
            },
          };
        });
        return shouldComplete;
      },

      advanceExercise: () =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              status: "active",
              rest_ends_at: null,
              rest_ring_total_sec: null,
              current_exercise_index: state.session.current_exercise_index + 1,
              current_set: 1,
              current_rep_count: 0,
              form_status: "unknown",
              last_correction: null,
              form_good_samples: 0,
              form_total_samples: 0,
              exercise_checkpoint_at: null,
              ai_ui_phase:
                state.session.session_type === "ai_camera" ? "tracking" : state.session.ai_ui_phase,
            },
          };
        }),

      completeSession: () =>
        set((state) =>
          state.session ? { session: { ...state.session, status: "completed" } } : state,
        ),

      abandonSession: () =>
        set((state) =>
          state.session ? { session: { ...state.session, status: "abandoned" } } : state,
        ),

      clearSession: () => set({ session: null }),

      setAiUiPhase: (phase) =>
        set((state) =>
          state.session ? { session: { ...state.session, ai_ui_phase: phase } } : state,
        ),

      setCurrentRepCount: (reps) =>
        set((state) =>
          state.session
            ? { session: { ...state.session, current_rep_count: Math.max(0, reps) } }
            : state,
        ),

      resetRepTracking: () =>
        set((state) =>
          state.session
            ? {
                session: {
                  ...state.session,
                  current_rep_count: 0,
                  form_status: "unknown",
                  last_correction: null,
                  form_good_samples: 0,
                  form_total_samples: 0,
                },
              }
            : state,
        ),

      updateFormTracking: (status, correction = null) =>
        set((state) => {
          if (!state.session) return state;
          const sample = status === "good" || status === "correction";
          return {
            session: {
              ...state.session,
              form_status: status,
              last_correction: status === "correction" ? correction : state.session.last_correction,
              form_total_samples: state.session.form_total_samples + (sample ? 1 : 0),
              form_good_samples:
                state.session.form_good_samples + (status === "good" ? 1 : 0),
            },
          };
        }),

      setAudioGuidanceEnabled: (enabled) =>
        set((state) =>
          state.session
            ? { session: { ...state.session, audio_guidance_enabled: enabled } }
            : state,
        ),

      markExerciseCheckpoint: () =>
        set((state) =>
          state.session
            ? {
                session: {
                  ...state.session,
                  ai_ui_phase: "exercise_complete",
                  exercise_checkpoint_at: new Date().toISOString(),
                },
              }
            : state,
        ),

      clearExerciseCheckpoint: () =>
        set((state) =>
          state.session
            ? { session: { ...state.session, exercise_checkpoint_at: null } }
            : state,
        ),
    }),
    {
      name: "workout-session-store",
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<WorkoutSessionStore>;
        const raw = p.session as WorkoutSession | null | undefined;
        if (!raw) return { ...current, ...p, session: null };
        // Backfill fields for sessions persisted before AI camera extension
        const session: WorkoutSession = {
          ...raw,
          session_type: raw.session_type ?? "standard",
          ai_ui_phase: raw.ai_ui_phase ?? "tracking",
          current_rep_count: raw.current_rep_count ?? 0,
          form_status: raw.form_status ?? "unknown",
          last_correction: raw.last_correction ?? null,
          audio_guidance_enabled: raw.audio_guidance_enabled ?? true,
          form_good_samples: raw.form_good_samples ?? 0,
          form_total_samples: raw.form_total_samples ?? 0,
          exercise_checkpoint_at: raw.exercise_checkpoint_at ?? null,
          rest_ring_total_sec: raw.rest_ring_total_sec ?? null,
          set_logs: (raw.set_logs || []).map((l) => ({
            ...l,
            tracking_method: l.tracking_method ?? "manual",
          })),
        };
        return { ...current, ...p, session };
      },
    },
  ),
);
