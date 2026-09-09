import { useConnectivityStore } from "../store/connectivityStore";

export function useCanReachBackend() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const serverWaking = useConnectivityStore((s) => s.serverWaking);
  return {
    isOnline,
    serverReachable,
    serverWaking,
    canReach: isOnline && serverReachable,
  };
}
