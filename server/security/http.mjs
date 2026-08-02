import crypto from "node:crypto";

import { ImageRouterError, rehydrateImageRouterError } from "../image/errors.mjs";
import { redactAttempts, redactText } from "./redaction.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(value) {
  return String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
}

function requestHostname(request) {
  const host = request.headers.get("host");
  try {
    return normalizeHostname(host ? new URL(`http://${host}`).hostname : new URL(request.url).hostname);
  } catch {
    return "";
  }
}

export function isLocalRequest(request) {
  const hostname = requestHostname(request);
  if (!LOCAL_HOSTS.has(hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try { return LOCAL_HOSTS.has(normalizeHostname(new URL(origin).hostname)); } catch { return false; }
}

export function hostGuard(request) {
  if (isLocalRequest(request)) return null;
  return Response.json({ error: { code: "HOST_NOT_ALLOWED", message: "ImageRouter accepts localhost requests only." } }, { status: 403 });
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function bearerGuard(request, expectedToken) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: { code: "MISSING_TOKEN", message: "Send the ImageRouter token as a Bearer token." } }, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }
  if (!constantTimeEqual(match[1], expectedToken)) {
    return Response.json({ error: { code: "INVALID_TOKEN", message: "The ImageRouter token is invalid." } }, {
      status: 403,
      headers: { "WWW-Authenticate": "Bearer error=\"invalid_token\"" },
    });
  }
  return null;
}

export function errorResponse(error) {
  const normalized = rehydrateImageRouterError(error)
    || new ImageRouterError(redactText(error?.message || "Request failed."), { code: "INTERNAL_ERROR", status: 500 });
  const attempts = redactAttempts(normalized.attempts);
  return Response.json({
    error: {
      code: normalized.code,
      message: redactText(normalized.message),
      retryable: normalized.retryable,
      attempts,
    },
  }, { status: normalized.status || 500 });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (cause) {
    throw new ImageRouterError("Request body must be valid JSON.", { code: "INVALID_JSON", status: 400, cause });
  }
}
