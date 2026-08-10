import { useCallback, useRef, useState } from "react";

type FacingMode = "user" | "environment";

const FLIP_TIMEOUT_MS = 4000;

/** Ignore rapid flip taps until WebView reports cameraFlipped (or timeout). */
export function useCameraFlipLock() {
  const flipInProgressRef = useRef(false);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flipInProgress, setFlipInProgress] = useState(false);

  const clearFlipTimeout = useCallback(() => {
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
  }, []);

  const finishFlip = useCallback(
    (facing?: string) => {
      flipInProgressRef.current = false;
      setFlipInProgress(false);
      clearFlipTimeout();
      if (facing === "user" || facing === "environment") {
        return facing as FacingMode;
      }
      return null;
    },
    [clearFlipTimeout],
  );

  const requestFlip = useCallback(
    (setFacingMode: React.Dispatch<React.SetStateAction<FacingMode>>) => {
      if (flipInProgressRef.current) return false;
      flipInProgressRef.current = true;
      setFlipInProgress(true);
      clearFlipTimeout();
      flipTimeoutRef.current = setTimeout(() => {
        flipInProgressRef.current = false;
        setFlipInProgress(false);
        flipTimeoutRef.current = null;
      }, FLIP_TIMEOUT_MS);
      setFacingMode((f) => (f === "user" ? "environment" : "user"));
      return true;
    },
    [clearFlipTimeout],
  );

  return { flipInProgress, requestFlip, finishFlip };
}
