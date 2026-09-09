import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { devLog } from "../utils/devLog";

type ConnectivityState = {
  isOnline: boolean;
  serverReachable: boolean;
  lastOnlineAt: number | null;
  serverWaking: boolean;
  setIsOnline: (value: boolean) => void;
  markServerReachable: () => void;
  markServerUnreachable: (opts?: { waking?: boolean }) => void;
  setServerWaking: (value: boolean) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  serverReachable: true,
  lastOnlineAt: Date.now(),
  serverWaking: false,
  setIsOnline: (value) => {
    set({
      isOnline: value,
      lastOnlineAt: value ? Date.now() : get().lastOnlineAt,
    });
  },
  markServerReachable: () => {
    set({ serverReachable: true, serverWaking: false, lastOnlineAt: Date.now() });
  },
  markServerUnreachable: (opts) => {
    set({
      serverReachable: false,
      serverWaking: Boolean(opts?.waking),
    });
  },
  setServerWaking: (value) => set({ serverWaking: value }),
}));

let netInfoSubscribed = false;

export function bootstrapConnectivity(): void {
  if (netInfoSubscribed) return;
  netInfoSubscribed = true;
  void NetInfo.fetch().then((state) => {
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    useConnectivityStore.getState().setIsOnline(online);
    devLog("[connectivity] initial", { online, type: state.type });
  });
  NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    useConnectivityStore.getState().setIsOnline(online);
  });
}

export function canReachBackend(): boolean {
  const { isOnline, serverReachable } = useConnectivityStore.getState();
  return isOnline && serverReachable;
}
