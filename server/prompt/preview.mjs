import { MAX_INLINE_PREVIEW_BYTES, MAX_INLINE_PREVIEW_COUNT } from "./constants.mjs";

const ALLOWED_HOSTS = ["github.com", "raw.githubusercontent.com", "githubusercontent.com", "youmind.com"];

function allowedHost(hostname) {
  const lower = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
}

function isPrivateAddress(hostname) {
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(hostname);
}

export function validatePreviewUrl(value, { allowedHosts } = {}) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const hostList = allowedHosts === undefined ? ALLOWED_HOSTS : allowedHosts;
  const matchesHost = hostList.some((allowed) => {
    const normalized = String(allowed || "").toLowerCase().replace(/^\.+/, "");
    return normalized && (url.hostname.toLowerCase() === normalized || url.hostname.toLowerCase().endsWith(`.${normalized}`));
  });
  if (url.protocol !== "https:" || !matchesHost || isPrivateAddress(url.hostname) || url.username || url.password) return null;
  return url;
}

async function readLimited(response, maxBytes, signal) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Preview exceeds the inline size limit.");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Preview exceeds the inline size limit.");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Preview exceeds the inline size limit.");
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function inlinePreviews(urls, { signal, maxBytes = MAX_INLINE_PREVIEW_BYTES, allowedHosts } = {}) {
  const safeMaxBytes = Math.min(MAX_INLINE_PREVIEW_BYTES, Math.max(0, Number(maxBytes) || MAX_INLINE_PREVIEW_BYTES));
  const selected = [...new Set((urls || []).map((url) => validatePreviewUrl(url, { allowedHosts })).filter(Boolean).map(String))].slice(0, MAX_INLINE_PREVIEW_COUNT);
  const blocks = [];
  let used = 0;
  for (const value of selected) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(value, { redirect: "error", signal: controller.signal, headers: { Accept: "image/*" } });
      if (!response.ok || !/^image\//i.test(response.headers.get("content-type") || "")) continue;
      const remaining = safeMaxBytes - used;
      if (remaining <= 0) break;
      const bytes = await readLimited(response, remaining, signal);
      used += bytes.length;
      blocks.push({ type: "image", data: bytes.toString("base64"), mimeType: response.headers.get("content-type").split(";", 1)[0] });
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return blocks;
}
