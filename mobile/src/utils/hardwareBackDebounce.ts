const DEBOUNCE_MS = 350;
let lastHandledAt = 0;

/** Returns true when the press should be ignored (too soon after the last handled press). */
export function shouldIgnoreRapidBackPress(): boolean {
  const now = Date.now();
  if (now - lastHandledAt < DEBOUNCE_MS) return true;
  lastHandledAt = now;
  return false;
}
