import { ImageRouterError, errorFromResponse, normalizeThrownError } from "../image/errors.mjs";

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_IMAGE_CHARACTERS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;

export function assertImageBytes(value, { provider } = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!bytes.length) {
    throw new ImageRouterError("Provider returned an empty image.", {
      code: "EMPTY_IMAGE",
      status: 502,
      retryable: true,
      provider,
    });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageRouterError("Provider image exceeds the 32 MB limit.", {
      code: "IMAGE_TOO_LARGE",
      status: 502,
      provider,
    });
  }
  return bytes;
}

export function decodeProviderImageBase64(value, { provider } = {}) {
  if (typeof value !== "string" || !value.trim()) return assertImageBytes(null, { provider });
  const compact = value.replace(/\s+/g, "");
  if (compact.length > MAX_BASE64_IMAGE_CHARACTERS) {
    throw new ImageRouterError("Provider image exceeds the 32 MB limit.", {
      code: "IMAGE_TOO_LARGE",
      status: 502,
      provider,
    });
  }
  if (compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new ImageRouterError("Provider returned invalid base64 image data.", {
      code: "INVALID_PROVIDER_OUTPUT",
      status: 502,
      provider,
    });
  }
  return assertImageBytes(Buffer.from(compact, "base64"), { provider });
}

export function decodeJwtPayload(token) {
  try {
    const [, body] = String(token || "").split(".");
    if (!body) return {};
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export function normalizeReferenceImage(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  const value = input.trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
  if (/^https:\/\//i.test(value)) return value;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100) {
    return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
  }
  return null;
}

export function toInlineData(input) {
  const normalized = normalizeReferenceImage(input);
  const match = normalized?.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

export function detectMimeType(bytes, fallback = "image/png") {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  return fallback;
}

export async function fetchWithTimeout(url, options = {}, { timeoutMs = 120000, signal, provider } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  let externallyCancelled = false;
  const onAbort = () => {
    externallyCancelled = true;
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, timeoutMs);
  timer.unref?.();

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw normalizeThrownError(error, provider, { timedOut, cancelled: externallyCancelled });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function assertOk(response, provider) {
  if (!response.ok) throw await errorFromResponse(response, provider);
  return response;
}

export async function imageFromProviderItem(item, { provider, signal, timeoutMs }) {
  const base64 = item?.b64_json || item?.base64 || item?.data;
  if (typeof base64 === "string" && base64.length > 0) {
    const bytes = decodeProviderImageBase64(base64, { provider });
    return { bytes, mimeType: item?.mime_type || detectMimeType(bytes) };
  }
  if (typeof item?.url === "string") {
    const parsed = new URL(item.url);
    if (parsed.protocol !== "https:") throw new ImageRouterError("Provider returned a non-HTTPS image URL.", { code: "INVALID_PROVIDER_OUTPUT", status: 502, provider });
    const response = await assertOk(await fetchWithTimeout(parsed, { headers: { Accept: "image/*" } }, { timeoutMs, signal, provider }), provider);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) throw new ImageRouterError("Provider image exceeds the 32 MB limit.", { code: "IMAGE_TOO_LARGE", status: 502, provider });
    const bytes = assertImageBytes(Buffer.from(await response.arrayBuffer()), { provider });
    const contentType = response.headers.get("content-type")?.split(";")[0];
    return { bytes, mimeType: contentType?.startsWith("image/") ? contentType : detectMimeType(bytes, item?.mime_type) };
  }
  throw new ImageRouterError("Provider returned no image data.", { code: "EMPTY_IMAGE", status: 502, retryable: true, provider });
}

export function tokenExpired(connection, leadMs = 300000) {
  return Boolean(connection.expiresAt && Number(connection.expiresAt) <= Date.now() + leadMs);
}

export function refreshedCredentialSet(current, tokens) {
  return {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || current.refreshToken,
    expiresIn: tokens.expires_in,
    expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : current.expiresAt,
  };
}
