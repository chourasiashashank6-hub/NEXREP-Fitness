import axios from "axios";

export type UpsertOnboardingErrorAction =
  | { type: "abort" }
  | { type: "continue_with_warning" }
  | { type: "fatal_abort" }
  | { type: "rethrow" };

function formatApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  return "";
}

/** Classify upsert-onboarding API failures for save-and-exit UX. */
export function classifyUpsertOnboardingError(error: unknown): UpsertOnboardingErrorAction {
  if (!axios.isAxiosError(error)) {
    return { type: "rethrow" };
  }

  const status = error.response?.status;
  const detailText = formatApiDetail(error.response?.data?.detail);
  const noResponse = error.response === undefined;
  const routeMissing = status === 404 && detailText === "Not Found";

  if (status === 401 || status === 403) {
    return { type: "abort" };
  }
  if (status === 422) {
    return { type: "fatal_abort" };
  }
  if (noResponse || routeMissing || status === 502 || status === 503 || status === 404) {
    return { type: "continue_with_warning" };
  }
  return { type: "fatal_abort" };
}

export const ONBOARDING_SERVER_UNAVAILABLE_NOTIFY = {
  titleKey: "onboardingSave.serverUnavailableTitle",
  bodyKey: "onboardingSave.serverUnavailableBody",
} as const;

/** User-visible warning when onboarding upsert fails but local save should continue. */
export function onboardingServerUnavailableNotification(
  error: unknown,
): typeof ONBOARDING_SERVER_UNAVAILABLE_NOTIFY | null {
  const action = classifyUpsertOnboardingError(error);
  return action.type === "continue_with_warning" ? ONBOARDING_SERVER_UNAVAILABLE_NOTIFY : null;
}
