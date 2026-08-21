import { create } from "zustand";
import { bumpActivityDataRefresh } from "./activityDataRefreshStore";

type XpRefreshState = {
  version: number;
  bump: () => void;
};

export const useXpRefreshStore = create<XpRefreshState>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
}));

/** Call after any server action that may award XP (workout log, meal log, etc.). */
export function bumpXpRefresh() {
  useXpRefreshStore.getState().bump();
  bumpActivityDataRefresh();
}
