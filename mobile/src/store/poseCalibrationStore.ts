import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getProfile, putPoseCalibration } from "../api/user";
import {
  DEFAULT_POSE_CALIBRATION,
  type PoseCalibration,
} from "../data/aiTrainer/types";
import { sanitizeLoadedCalibration } from "../utils/calibrationMerge";

type PoseCalibrationState = {
  calibration: PoseCalibration | null;
  /** User skipped calibration — use population defaults for this device. */
  skipped: boolean;
  /** Stored calibration failed validation — user should recalibrate. */
  needsRecalibration: boolean;
  hydrated: boolean;
  setCalibration: (cal: PoseCalibration) => Promise<void>;
  skipCalibration: () => void;
  clearSkip: () => void;
  clearRecalibrationFlag: () => void;
  loadFromProfile: () => Promise<void>;
  hasCalibration: () => boolean;
  effectiveCalibration: () => PoseCalibration;
};

export const usePoseCalibrationStore = create<PoseCalibrationState>()(
  persist(
    (set, get) => ({
      calibration: null,
      skipped: false,
      needsRecalibration: false,
      hydrated: false,
      setCalibration: async (cal) => {
        set({ calibration: cal, skipped: false, needsRecalibration: false });
        try {
          await putPoseCalibration(cal);
        } catch {
          // Offline: local persist still keeps session usable
        }
      },
      skipCalibration: () => set({ skipped: true }),
      clearSkip: () => set({ skipped: false }),
      clearRecalibrationFlag: () => set({ needsRecalibration: false }),
      loadFromProfile: async () => {
        try {
          const profile = await getProfile();
          const raw = (profile as { pose_calibration?: PoseCalibration; poseCalibration?: PoseCalibration })
            .pose_calibration || (profile as { poseCalibration?: PoseCalibration }).poseCalibration;
          if (raw && typeof raw.torsoLen === "number") {
            const { calibration, needsRecalibration } = sanitizeLoadedCalibration(raw as PoseCalibration);
            set({
              calibration: calibration ?? (raw as PoseCalibration),
              skipped: false,
              needsRecalibration,
            });
          }
        } catch {
          // keep local cache
        } finally {
          const local = get().calibration;
          if (local) {
            const { calibration, needsRecalibration } = sanitizeLoadedCalibration(local);
            if (calibration && calibration !== local) {
              set({ calibration, needsRecalibration });
            } else if (needsRecalibration) {
              set({ needsRecalibration: true });
            }
          }
          set({ hydrated: true });
        }
      },
      hasCalibration: () => {
        const c = get().calibration;
        return Boolean(c && c.torsoLen > 0 && c.calibratedAt);
      },
      effectiveCalibration: () => {
        const c = get().calibration;
        if (c && c.torsoLen > 0) return c;
        return DEFAULT_POSE_CALIBRATION;
      },
    }),
    {
      name: "pose-calibration-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        calibration: s.calibration,
        skipped: s.skipped,
        needsRecalibration: s.needsRecalibration,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.calibration) {
          const { calibration, needsRecalibration } = sanitizeLoadedCalibration(state.calibration);
          usePoseCalibrationStore.setState({
            hydrated: true,
            calibration: calibration ?? state.calibration,
            needsRecalibration: needsRecalibration || state.needsRecalibration,
          });
        } else {
          usePoseCalibrationStore.setState({ hydrated: true });
        }
      },
    },
  ),
);
