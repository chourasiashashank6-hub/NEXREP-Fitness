import { useConnectivityStore } from "../store/connectivityStore";
import { devLog } from "./devLog";
import { isNetworkError, isTimeoutError } from "./toUserMessage";

const WAKE_DELAYS_MS = [8_000, 20_000, 40_000];

export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; onWaking?: () => void },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? WAKE_DELAYS_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      useConnectivityStore.getState().markServerReachable();
      return result;
    } catch (error) {
      lastError = error;
      const isLast = attempt >= maxAttempts - 1;
      const { isOnline } = useConnectivityStore.getState();
      const wakingCandidate = isOnline && (isTimeoutError(error) || isNetworkError(error));

      if (!wakingCandidate || isLast) {
        useConnectivityStore.getState().markServerUnreachable({ waking: false });
        throw error;
      }

      useConnectivityStore.getState().markServerUnreachable({ waking: true });
      opts?.onWaking?.();
      const delay = WAKE_DELAYS_MS[attempt] ?? WAKE_DELAYS_MS[WAKE_DELAYS_MS.length - 1];
      devLog(`[fetchWithRetry] attempt ${attempt + 1} failed; retrying in ${delay}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
