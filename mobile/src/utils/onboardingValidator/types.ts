export type ValidationIssue = {
  valid: false;
  field: string;
  code: string;
  params?: Record<string, string | number>;
};

export type ValidationOk = { valid: true };

export type ValidationResult = ValidationOk | ValidationIssue;

export function issue(
  field: string,
  code: string,
  params?: Record<string, string | number>,
): ValidationIssue {
  return { valid: false, field, code, params };
}

export function ok(): ValidationOk {
  return { valid: true };
}

export function isIssue(result: ValidationResult): result is ValidationIssue {
  return result.valid === false;
}
