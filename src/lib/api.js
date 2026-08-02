export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request returned HTTP ${response.status}`);
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.attempts = payload?.error?.attempts || [];
    throw error;
  }
  return payload;
}
