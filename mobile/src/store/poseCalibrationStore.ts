import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getProfile, putPoseCalibration } from "../api/user";
import {
  DEFAULT_POSE_CALIBRATION,
  type PoseCalibration,
} from "../data/aiTrainer/types";

type PoseCalibrationState = {
  calibration: PoseCalibration | null;
  /** User skipped calibration — use population defaults for this device. */
  skipped: boolean;
  hydrated: boolean;
  setCalibration: (cal: PoseCalibration) => Promise<void>;
  skipCalibration: () => void;
  clearSkip: () => void;
  loadFromProfile: () => Promise<void>;
  hasCalibration: () => boolean;
  effectiveCalibration: () => PoseCalibration;
};

export const usePoseCalibrationStore = create<PoseCalibrationState>()(
  persist(
    (set, get) => ({
      calibration: null,
      skipped: false,
      hydrated: false,
      setCalibration: async (cal) => {
        set({ calibration: cal, skipped: false });
        try {
          await putPoseCalibration(cal);
        } catch {
          // Offline: local persist still keeps session usable
        }
      },
      skipCalibration: () => set({ skipped: true }),
      clearSkip: () => set({ skipped: false }),
      loadFromProfile: async () => {
        try {
          const profile = await getProfile();
          const raw = (profile as { pose_calibration?: PoseCalibration; poseCalibration?: PoseCalibration })
            .pose_calibration || (profile as { poseCalibration?: PoseCalibration }).poseCalibration;
          if (raw && typeof raw.torsoLen === "number") {
            set({ calibration: raw as PoseCalibration, skipped: false });
          }
        } catch {
          // keep local cache
        } finally {
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
      partialize: (s) => ({ calibration: s.calibration, skipped: s.skipped }),
      onRehydrateStorage: () => () => {
        usePoseCalibrationStore.setState({ hydrated: true });
      },
    },
  ),
);
