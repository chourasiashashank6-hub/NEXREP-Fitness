import type { OnboardingData } from "../types/onboarding";
import i18n from "../i18n";
import {
  validationMessage,
  validateOnboardingForSave as collectSaveIssues,
  validateOnboardingPartialSave as collectPartialSaveIssues,
} from "./onboardingValidator";

function firstIssueMessage(issues: ReturnType<typeof collectSaveIssues>): string | null {
  if (!issues.length) return null;
  return validationMessage(i18n.t.bind(i18n), issues[0]);
}

/** Minimum data required before saving targets / calling the API (all screens). */
export function validateOnboardingForSave(data: OnboardingData): string | null {
  return firstIssueMessage(collectSaveIssues(data));
}

/** Progressive save — only validate screens 1…throughStep (max 4). */
export function validateOnboardingPartialSave(data: OnboardingData, throughStep: number): string | null {
  return firstIssueMessage(collectPartialSaveIssues(data, throughStep));
}
