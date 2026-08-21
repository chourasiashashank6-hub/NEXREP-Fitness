import { create } from "zustand";
import { invalidateSessionCache } from "../utils/sessionDataCache";

type ActivityDataRefreshState = {
  version: number;
  bump: () => void;
};

export const useActivityDataRefreshStore = create<ActivityDataRefreshState>((set) => ({
  version: 0,
  bump: () => {
    invalidateSessionCache();
    set((state) => ({ version: state.version + 1 }));
  },
}));

/** Call after any server action that changes today's logs, burn, milestones, or coach inputs. */
export function bumpActivityDataRefresh() {
  useActivityDataRefreshStore.getState().bump();
}
