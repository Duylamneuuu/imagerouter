const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|credential|bearer)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_TOKEN_PATTERN = /\b(?:sk|xai|eyJ)[-_A-Za-z0-9.]{16,}\b/g;

export function redactText(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      text = text.split(secret).join("[REDACTED]");
    }
  }
  return text
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(LONG_TOKEN_PATTERN, "[REDACTED]")
    .slice(0, 600);
}

export function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactObject(child);
  }
  return result;
}

export function collectSecrets(credentials = {}) {
  return Object.entries(credentials)
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && typeof value === "string")
    .map(([, value]) => value);
}

export function redactAttempts(attempts = []) {
  if (!Array.isArray(attempts)) return [];
  return attempts.map((attempt) => ({
    ...attempt,
    message: attempt?.message == null ? null : redactText(attempt.message),
  }));
}
