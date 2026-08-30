/**
 * Run: npx --yes tsx src/hooks/onboardingSaveUpsertError.test.ts
 * (from mobile/)
 */
import axios from "axios";
import {
  ONBOARDING_SERVER_UNAVAILABLE_NOTIFY,
  classifyUpsertOnboardingError,
  onboardingServerUnavailableNotification,
} from "./onboardingSaveUpsertError";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function axiosError(status?: number, detail?: unknown) {
  return new axios.AxiosError(
    "request failed",
    status ? String(status) : "ERR_NETWORK",
    undefined,
    undefined,
    status
      ? {
          status,
          statusText: String(status),
          headers: {},
          config: {} as never,
          data: detail === undefined ? {} : { detail },
        }
      : undefined,
  );
}

assert(classifyUpsertOnboardingError(axiosError(502)).type === "continue_with_warning", "502 warns and continues");
assert(classifyUpsertOnboardingError(axiosError(503)).type === "continue_with_warning", "503 warns and continues");
assert(classifyUpsertOnboardingError(axiosError(404, "Not Found")).type === "continue_with_warning", "404 route warns");
assert(classifyUpsertOnboardingError(axiosError()).type === "continue_with_warning", "network error warns");

assert(classifyUpsertOnboardingError(axiosError(401)).type === "abort", "401 aborts");
assert(classifyUpsertOnboardingError(axiosError(422, "bad data")).type === "fatal_abort", "422 fatal");
assert(classifyUpsertOnboardingError(axiosError(500, "boom")).type === "fatal_abort", "500 fatal");

const notified: Array<{ titleKey: string; bodyKey: string }> = [];
for (const status of [502, 503, 404] as const) {
  const warning = onboardingServerUnavailableNotification(
    axiosError(status, status === 404 ? "Not Found" : undefined),
  );
  if (warning) notified.push(warning);
}
assert(notified.length === 3, "each recoverable failure surfaces server-unavailable copy to the user");
assert(
  onboardingServerUnavailableNotification(axiosError(401)) === null,
  "auth failures do not show server-unavailable warning",
);
assert(
  onboardingServerUnavailableNotification(axiosError(422, "bad data")) === null,
  "validation failures do not show server-unavailable warning",
);
assert(
  notified.every(
    (entry) =>
      entry.titleKey === "onboardingSave.serverUnavailableTitle" &&
      entry.bodyKey === "onboardingSave.serverUnavailableBody",
  ),
  "warning uses onboardingSave.serverUnavailable* i18n keys",
);

console.log("onboardingSaveUpsertError.test.ts: all passed");
