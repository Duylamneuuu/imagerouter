import { redactText } from "../security/redaction.mjs";

const SAFETY_PATTERN = /(safety|content policy|moderation|blocked|harmful|prohibited)/i;
const QUOTA_PATTERN = /(quota|rate.?limit|too many requests|billing limit|credits? exhausted)/i;
const CAPACITY_PATTERN = /(capacity|high traffic|overloaded|temporarily unavailable|try again later)/i;
const INVALID_PATTERN = /(invalid|malformed|required field|unsupported parameter|prompt is too long)/i;

export class ImageRouterError extends Error {
  constructor(message, { code = "INTERNAL_ERROR", status = 500, retryable = false, provider = null, cause } = {}) {
    super(message, { cause });
    this.name = "ImageRouterError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}

export function isImageRouterError(error) {
  if (error instanceof ImageRouterError) return true;
  return Boolean(
    error
    && typeof error === "object"
    && typeof error.message === "string"
    && typeof error.code === "string"
    && Number.isFinite(Number(error.status))
    && typeof error.retryable === "boolean",
  );
}

export function rehydrateImageRouterError(error) {
  if (error instanceof ImageRouterError) return error;
  if (!isImageRouterError(error)) return null;
  const normalized = new ImageRouterError(redactText(error.message), {
    code: error.code,
    status: Number(error.status),
    retryable: error.retryable,
    provider: error.provider || null,
    cause: error,
  });
  if (Array.isArray(error.attempts)) normalized.attempts = error.attempts;
  if (Number.isFinite(Number(error.fallbackCount))) normalized.fallbackCount = Number(error.fallbackCount);
  return normalized;
}

export async function errorFromResponse(response, provider) {
  let body = "";
  try { body = await response.clone().text(); } catch {}
  let parsed;
  try { parsed = JSON.parse(body); } catch {}
  const message = redactText(
    parsed?.error?.message || parsed?.message || parsed?.error || body || `Upstream returned HTTP ${response.status}`,
  );
  const status = response.status;

  if (SAFETY_PATTERN.test(message)) {
    return new ImageRouterError("The provider rejected the request for safety reasons.", { code: "SAFETY_REJECTION", status, provider });
  }
  if (status === 429 || status === 402 || QUOTA_PATTERN.test(message)) {
    return new ImageRouterError(message, { code: status === 429 ? "RATE_LIMITED" : "QUOTA_EXHAUSTED", status, retryable: true, provider });
  }
  if (status === 408) {
    return new ImageRouterError(message, { code: "TIMEOUT", status, retryable: true, provider });
  }
  if (status >= 500 || CAPACITY_PATTERN.test(message)) {
    return new ImageRouterError(message, { code: CAPACITY_PATTERN.test(message) ? "CAPACITY" : "UPSTREAM_5XX", status, retryable: true, provider });
  }
  if (status === 401 || status === 403) {
    return new ImageRouterError(message || "Provider authorization failed.", { code: "AUTH_FAILED", status, provider });
  }
  if (status === 400 || status === 404 || status === 405 || status === 409 || status === 413 || status === 415 || status === 422 || INVALID_PATTERN.test(message)) {
    return new ImageRouterError(message, { code: "INVALID_REQUEST", status, provider });
  }
  return new ImageRouterError(message, { code: "UPSTREAM_ERROR", status, provider });
}

export function normalizeThrownError(error, provider, { timedOut = false, cancelled = false } = {}) {
  const typedError = rehydrateImageRouterError(error);
  if (typedError) return typedError;
  if (cancelled) return new ImageRouterError("Image generation was cancelled.", { code: "CANCELLED", status: 499, provider, cause: error });
  if (timedOut || error?.name === "TimeoutError") {
    return new ImageRouterError("The provider timed out.", { code: "TIMEOUT", status: 504, retryable: true, provider, cause: error });
  }
  if (error?.name === "AbortError") {
    return new ImageRouterError("Image generation was cancelled.", { code: "CANCELLED", status: 499, provider, cause: error });
  }
  if (error instanceof TypeError || /fetch|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error?.message || "")) {
    return new ImageRouterError("The provider could not be reached.", { code: "NETWORK_ERROR", status: 502, retryable: true, provider, cause: error });
  }
  return new ImageRouterError(redactText(error?.message || "Provider request failed."), { code: "UPSTREAM_ERROR", status: 502, provider, cause: error });
}

export function capabilityError(message, provider) {
  return new ImageRouterError(message, { code: "CAPABILITY_MISMATCH", status: 400, provider });
}

export function configurationError(message, provider) {
  return new ImageRouterError(message, { code: "CONFIGURATION_ERROR", status: 400, provider });
}
