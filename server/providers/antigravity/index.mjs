import crypto from "node:crypto";
import os from "node:os";

import { ImageRouterError, configurationError } from "../../image/errors.mjs";
import { assertOk, decodeProviderImageBase64, fetchWithTimeout, refreshedCredentialSet, toInlineData } from "../shared.mjs";

// Private endpoint envelopes include MIT-licensed upstream adaptations.

export const ANTIGRAVITY_OAUTH = Object.freeze({
  clientId: process.env.IMAGEROUTER_ANTIGRAVITY_CLIENT_ID || "",
  clientSecret: process.env.IMAGEROUTER_ANTIGRAVITY_CLIENT_SECRET || "",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
});

const API_BASE = "https://daily-cloudcode-pa.googleapis.com";
const CONTROL_BASE = "https://cloudcode-pa.googleapis.com";
const USER_AGENT = "antigravity/ide/2.1.1 darwin/arm64";
const DEFAULT_TIER = "legacy-tier";

function platformEnum() {
  if (process.platform === "darwin") return os.arch() === "arm64" ? 2 : 1;
  if (process.platform === "linux") return os.arch() === "arm64" ? 4 : 3;
  if (process.platform === "win32") return 5;
  return 0;
}

export function antigravityMetadata() {
  return { ideType: 9, platform: platformEnum(), pluginType: 2 };
}

function headers(credentials, load = false) {
  return {
    Authorization: `Bearer ${credentials.accessToken || ""}`,
    "Content-Type": "application/json",
    "User-Agent": load ? "google-api-nodejs-client/9.15.1" : USER_AGENT,
    ...(load ? {
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify(antigravityMetadata()),
      "x-request-source": "local",
    } : {}),
  };
}

function requestId(model) {
  return `agent/${crypto.randomUUID()}/${Date.now()}/${crypto.randomUUID()}/1`;
}

function extractProjectId(payload) {
  const project = payload?.cloudaicompanionProject ?? payload?.response?.cloudaicompanionProject;
  if (typeof project === "string" && project.trim()) return project.trim();
  if (typeof project?.id === "string" && project.id.trim()) return project.id.trim();
  return null;
}

function defaultTier(payload) {
  const selected = payload?.allowedTiers?.find((tier) => tier?.isDefault && typeof tier.id === "string" && tier.id.trim());
  return selected?.id.trim() || DEFAULT_TIER;
}

function generateFallbackProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adjective = adjectives[crypto.randomInt(adjectives.length)];
  const noun = nouns[crypto.randomInt(nouns.length)];
  return `${adjective}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

function extractText(payload) {
  const candidates = payload.candidates || payload.response?.candidates || [];
  return candidates[0]?.content?.parts?.map((part) => part.text || "").filter(Boolean).join("\n") || payload.text || "";
}

function waitForProvisioning(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function resolveAntigravityProjectId(credentials, {
  signal,
  timeoutMs = 30000,
  forceLoad = false,
  maxOnboardAttempts = 10,
  onboardDelayMs = 5000,
} = {}) {
  if (!credentials.accessToken) throw configurationError("Antigravity requires an OAuth access token.", "antigravity");
  if (credentials.projectId && !forceLoad) return credentials.projectId;

  const requestTimeoutMs = Math.min(timeoutMs || 30000, 30000);
  const loadResponse = await assertOk(await fetchWithTimeout(`${CONTROL_BASE}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: headers(credentials, true),
    body: JSON.stringify({ metadata: antigravityMetadata() }),
  }, { signal, timeoutMs: requestTimeoutMs, provider: "antigravity" }), "antigravity");
  const loadPayload = await loadResponse.json();
  const loadedProjectId = extractProjectId(loadPayload);
  if (loadedProjectId) return loadedProjectId;
  if (credentials.projectId) return credentials.projectId;

  const tierId = defaultTier(loadPayload);
  const attempts = Math.min(10, Math.max(1, Number(maxOnboardAttempts) || 1));
  const delayMs = Math.min(10000, Math.max(0, Number(onboardDelayMs) || 0));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const onboardResponse = await assertOk(await fetchWithTimeout(`${CONTROL_BASE}/v1internal:onboardUser`, {
      method: "POST",
      headers: headers(credentials, true),
      body: JSON.stringify({ tierId, metadata: antigravityMetadata() }),
    }, { signal, timeoutMs: requestTimeoutMs, provider: "antigravity" }), "antigravity");
    const onboardPayload = await onboardResponse.json();
    const provisionedProjectId = extractProjectId(onboardPayload);
    if (provisionedProjectId) return provisionedProjectId;
    // Antigravity can report onboarding complete while omitting the project
    // object. The upstream executor tolerated this with a generated project ID.
    // Return it here so ImageRouter persists one stable value per account.
    if (onboardPayload?.done === true) return generateFallbackProjectId();
    if (attempt < attempts) await waitForProvisioning(delayMs, signal);
  }

  throw new ImageRouterError("Google Code Assist is still provisioning this account. Try the connection test again shortly.", {
    code: "CAPACITY",
    status: 503,
    retryable: true,
    provider: "antigravity",
  });
}

export const antigravityAdapter = {
  id: "antigravity",

  async prepare({ credentials, signal, timeoutMs }) {
    if (credentials.projectId) return null;
    const projectId = await resolveAntigravityProjectId(credentials, { signal, timeoutMs });
    return { credentialPatch: { projectId } };
  },

  async refresh(credentials, { signal, timeoutMs } = {}) {
    if (!credentials.refreshToken) throw configurationError("This Antigravity account has no refresh token.", "antigravity");
    const response = await assertOk(await fetchWithTimeout(ANTIGRAVITY_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: ANTIGRAVITY_OAUTH.clientId,
        client_secret: ANTIGRAVITY_OAUTH.clientSecret,
      }),
    }, { signal, timeoutMs: Math.min(timeoutMs || 30000, 30000), provider: "antigravity" }), "antigravity");
    return refreshedCredentialSet(credentials, await response.json());
  },

  async generate({ model, prompt, referenceImages = [], aspectRatio, credentials, signal, timeoutMs }) {
    if (!credentials.accessToken) throw configurationError("Antigravity requires an OAuth access token.", "antigravity");
    if (!credentials.projectId) throw configurationError("Antigravity requires a Code Assist project ID. Reconnect the account.", "antigravity");
    const parts = [];
    for (const input of referenceImages) {
      const inlineData = toInlineData(input);
      if (!inlineData) throw configurationError("Antigravity reference images must be data URIs or base64 image data.", "antigravity");
      parts.push({ inlineData });
    }
    parts.push({ text: prompt });
    const sessionId = `${crypto.randomUUID()}${Date.now()}`;
    const request = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        imageConfig: { aspectRatio: aspectRatio || "1:1" },
      },
      sessionId,
    };
    const body = {
      project: credentials.projectId,
      model,
      userAgent: "antigravity",
      requestType: "image_gen",
      requestId: requestId(model),
      request,
    };
    const response = await assertOk(await fetchWithTimeout(`${API_BASE}/v1internal:generateContent`, {
      method: "POST",
      headers: headers(credentials),
      body: JSON.stringify(body),
    }, { signal, timeoutMs, provider: "antigravity" }), "antigravity");
    const payload = await response.json();
    const candidates = payload.candidates || payload.response?.candidates || [];
    const imagePart = candidates[0]?.content?.parts?.find((part) => part.inlineData?.data);
    if (!imagePart) throw new ImageRouterError("Antigravity returned no inline image.", { code: "EMPTY_IMAGE", status: 502, retryable: true, provider: "antigravity" });
    return {
      bytes: decodeProviderImageBase64(imagePart.inlineData.data, { provider: "antigravity" }),
      mimeType: imagePart.inlineData.mimeType || "image/png",
      model,
    };
  },

  async listTextModels({ credentials }) {
    if (!credentials.accessToken) throw configurationError("Antigravity requires an OAuth access token.", "antigravity");
    return ["gemini-3.1-flash"];
  },

  async enhance({ model, systemPrompt, prompt, credentials, signal, timeoutMs }) {
    if (!credentials.accessToken) throw configurationError("Antigravity requires an OAuth access token.", "antigravity");
    if (!credentials.projectId) throw configurationError("Antigravity requires a Code Assist project ID. Reconnect the account.", "antigravity");
    const sessionId = `${crypto.randomUUID()}${Date.now()}`;
    const request = {
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40, maxOutputTokens: 4096 },
      sessionId,
    };
    const response = await assertOk(await fetchWithTimeout(`${API_BASE}/v1internal:generateContent`, {
      method: "POST",
      headers: headers(credentials),
      body: JSON.stringify({
        project: credentials.projectId,
        model,
        userAgent: "antigravity",
        requestType: "agent",
        requestId: requestId(model),
        request,
      }),
    }, { signal, timeoutMs, provider: "antigravity" }), "antigravity");
    const text = extractText(await response.json());
    return { text, model };
  },

  async health({ credentials, signal, timeoutMs = 15000 }) {
    if (!credentials.accessToken) throw configurationError("Antigravity requires an OAuth access token.", "antigravity");
    const projectId = await resolveAntigravityProjectId(credentials, { signal, timeoutMs, forceLoad: true });
    return { ok: true, models: [], credentialPatch: projectId !== credentials.projectId ? { projectId } : null };
  },
};
