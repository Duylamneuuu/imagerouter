import { configurationError } from "../../image/errors.mjs";
import { assertOk, fetchWithTimeout, imageFromProviderItem, normalizeReferenceImage, refreshedCredentialSet } from "../shared.mjs";

// OAuth and image request behavior includes MIT-licensed upstream adaptations.

export const XAI_OAUTH = Object.freeze({
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  authorizeUrl: "https://auth.x.ai/oauth2/authorize",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  discoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
  scope: "openid profile email offline_access grok-cli:access api:access",
  port: 56121,
  callbackPath: "/callback",
});

const API_BASE = "https://api.x.ai/v1";
const RESPONSES_URL = `${API_BASE}/responses`;
let discoveredOAuthEndpoints = null;

function validOAuthEndpoint(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || (parsed.hostname !== "x.ai" && !parsed.hostname.endsWith(".x.ai"))) {
    throw new Error("xAI OAuth discovery returned an untrusted endpoint");
  }
  return parsed.toString();
}

export async function discoverXaiOAuthEndpoints({ signal, timeoutMs = 10000 } = {}) {
  if (discoveredOAuthEndpoints) return discoveredOAuthEndpoints;
  try {
    const response = await fetchWithTimeout(XAI_OAUTH.discoveryUrl, {
      headers: { Accept: "application/json" },
    }, { signal, timeoutMs, provider: "xai" });
    if (response.ok) {
      const payload = await response.json();
      discoveredOAuthEndpoints = {
        authorizeUrl: validOAuthEndpoint(payload.authorization_endpoint),
        tokenUrl: validOAuthEndpoint(payload.token_endpoint),
      };
      return discoveredOAuthEndpoints;
    }
  } catch {}
  discoveredOAuthEndpoints = { authorizeUrl: XAI_OAUTH.authorizeUrl, tokenUrl: XAI_OAUTH.tokenUrl };
  return discoveredOAuthEndpoints;
}

function token(credentials) {
  return credentials.apiKey || credentials.accessToken;
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = payload?.output || [];
  const text = output.flatMap((item) => item?.content || []).map((item) => item?.text || item?.value || "").filter(Boolean).join("\n");
  if (text) return text;
  return payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "";
}

export const xaiAdapter = {
  id: "xai",

  async refresh(credentials, { signal, timeoutMs } = {}) {
    if (!credentials.refreshToken) throw configurationError("This xAI account has no refresh token.", "xai");
    const { tokenUrl } = await discoverXaiOAuthEndpoints({ signal, timeoutMs: Math.min(timeoutMs || 10000, 10000) });
    const response = await assertOk(await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: XAI_OAUTH.clientId,
        refresh_token: credentials.refreshToken,
      }),
    }, { signal, timeoutMs: Math.min(timeoutMs || 30000, 30000), provider: "xai" }), "xai");
    return refreshedCredentialSet(credentials, await response.json());
  },

  async generate({ model, prompt, referenceImages = [], aspectRatio, credentials, signal, timeoutMs }) {
    const authToken = token(credentials);
    if (!authToken) throw configurationError("xAI requires an API key or OAuth access token.", "xai");
    const references = referenceImages.map(normalizeReferenceImage);
    if (references.some((value) => !value)) throw configurationError("xAI reference images must be HTTPS URLs, data URIs or base64 image data.", "xai");
    const body = { model, prompt, n: 1, response_format: "b64_json" };
    if (aspectRatio) body.aspect_ratio = aspectRatio;
    if (references.length === 1) body.image = { type: "image_url", url: references[0] };
    if (references.length > 1) body.images = references.map((url) => ({ type: "image_url", url }));
    const endpoint = references.length ? `${API_BASE}/images/edits` : `${API_BASE}/images/generations`;
    const response = await assertOk(await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "imagerouter/1.0.0",
      },
      body: JSON.stringify(body),
    }, { signal, timeoutMs, provider: "xai" }), "xai");
    const payload = await response.json();
    return { ...(await imageFromProviderItem(payload?.data?.[0], { provider: "xai", signal, timeoutMs })), model };
  },

  async listTextModels({ credentials, signal, timeoutMs = 15000 }) {
    const authToken = token(credentials);
    if (!authToken) throw configurationError("xAI requires an API key or OAuth access token.", "xai");
    const response = await assertOk(await fetchWithTimeout(`${API_BASE}/language-models`, {
      headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json" },
    }, { signal, timeoutMs, provider: "xai" }), "xai");
    const payload = await response.json();
    return (payload.models || payload.data || []).filter((item) => (item.output_modalities || item.outputModalities || []).map(String).some((value) => value.toLowerCase() === "text")).map((item) => item.id || item.name).filter(Boolean);
  },

  async enhance({ model, systemPrompt, prompt, credentials, signal, timeoutMs }) {
    const authToken = token(credentials);
    if (!authToken) throw configurationError("xAI requires an API key or OAuth access token.", "xai");
    const response = await assertOk(await fetchWithTimeout(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "imagerouter/1.0.0",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] },
        ],
        temperature: 0.2,
        max_output_tokens: 4096,
        store: false,
      }),
    }, { signal, timeoutMs, provider: "xai" }), "xai");
    const payload = await response.json();
    return { text: responseText(payload), model };
  },

  async health({ credentials, signal, timeoutMs = 15000 }) {
    const authToken = token(credentials);
    if (!authToken) throw configurationError("xAI requires an API key or OAuth access token.", "xai");
    const response = await assertOk(await fetchWithTimeout(`${API_BASE}/image-generation-models`, {
      headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json" },
    }, { signal, timeoutMs, provider: "xai" }), "xai");
    const payload = await response.json();
    return { ok: true, models: (payload.models || payload.data || []).map((item) => item.id).filter(Boolean) };
  },
};
