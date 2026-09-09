import type { TFunction } from "i18next";
import type { ValidationIssue } from "./types";

export function validationMessage(t: TFunction, issue: ValidationIssue): string {
  const key = `onboarding.validation.${issue.code}`;
  return t(key, { ...(issue.params ?? {}), defaultValue: issue.code });
}

export function issuesToFieldErrors(t: TFunction, issues: ValidationIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of issues) {
    if (!out[item.field]) {
      out[item.field] = validationMessage(t, item);
    }
  }
  return out;
}
