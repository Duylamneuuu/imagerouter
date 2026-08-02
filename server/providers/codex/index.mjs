import crypto from "node:crypto";

import { ImageRouterError, configurationError } from "../../image/errors.mjs";
import { assertOk, decodeJwtPayload, decodeProviderImageBase64, fetchWithTimeout, normalizeReferenceImage, refreshedCredentialSet } from "../shared.mjs";

// Private Responses/SSE behavior includes MIT-licensed upstream adaptations.

export const CODEX_OAUTH = Object.freeze({
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  scope: "openid profile email offline_access",
  port: 1455,
  callbackPath: "/auth/callback",
});

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const VERSION = "0.136.0";

function accountId(credentials) {
  if (credentials.chatgptAccountId) return credentials.chatgptAccountId;
  const payload = decodeJwtPayload(credentials.idToken);
  return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null;
}

function headers(credentials) {
  const id = accountId(credentials);
  return {
    accept: "text/event-stream, application/json",
    authorization: `Bearer ${credentials.accessToken || ""}`,
    ...(id ? { "chatgpt-account-id": id } : {}),
    "content-type": "application/json",
    originator: "codex_cli_rs",
    session_id: crypto.randomUUID(),
    "user-agent": `codex_cli_rs/${VERSION}`,
    version: VERSION,
    "x-client-request-id": crypto.randomUUID(),
  };
}

function contentParts(prompt, referenceImages) {
  const content = [];
  referenceImages.forEach((input, index) => {
    const imageUrl = normalizeReferenceImage(input);
    if (!imageUrl) throw configurationError("Codex reference images must be HTTPS URLs, data URIs or base64 image data.", "codex");
    content.push({ type: "input_text", text: `<image name=image${index + 1}>` });
    content.push({ type: "input_image", image_url: imageUrl, detail: "high" });
    content.push({ type: "input_text", text: "</image>" });
  });
  content.push({ type: "input_text", text: prompt });
  return content;
}

export async function parseCodexImageStream(response, { signal } = {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageRouterError("Codex returned no response stream.", { code: "EMPTY_IMAGE", status: 502, retryable: true, provider: "codex" });
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  const processBlock = (block) => {
    let eventName = "";
    const dataLines = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine.startsWith("event:")) eventName = rawLine.slice(6).trim();
      if (rawLine.startsWith("data:")) dataLines.push(rawLine.slice(5).trim());
    }
    if (eventName !== "response.output_item.done" || !dataLines.length) return;
    try {
      const payload = JSON.parse(dataLines.join("\n"));
      if (payload?.item?.type === "image_generation_call" && payload.item.result) result = payload.item.result;
    } catch {}
  };

  while (true) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(processBlock);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);
  if (!result) throw new ImageRouterError("Codex returned no image. The account may not have image entitlement.", { code: "EMPTY_IMAGE", status: 502, retryable: true, provider: "codex" });
  const bytes = decodeProviderImageBase64(result, { provider: "codex" });
  return { bytes, mimeType: "image/png" };
}

export async function parseCodexTextStream(response, { signal } = {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageRouterError("Codex returned no text stream.", { code: "EMPTY_ENHANCEMENT", status: 502, retryable: true, provider: "codex" });
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const processBlock = (block) => {
    let eventName = "";
    const dataLines = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine.startsWith("event:")) eventName = rawLine.slice(6).trim();
      if (rawLine.startsWith("data:")) dataLines.push(rawLine.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload;
    try { payload = JSON.parse(dataLines.join("\n")); } catch { return; }
    if (eventName === "response.output_text.delta" || typeof payload.delta === "string") text += payload.delta;
    if (eventName === "response.output_item.done") {
      const parts = payload.item?.content || [];
      text += parts.map((part) => part.text || "").filter(Boolean).join("\n");
    }
    if (typeof payload.output_text === "string" && !text) text = payload.output_text;
  };
  while (true) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(processBlock);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);
  if (!text.trim()) throw new ImageRouterError("Codex returned no enhancer text.", { code: "EMPTY_ENHANCEMENT", status: 502, retryable: true, provider: "codex" });
  return text.trim();
}

export const codexAdapter = {
  id: "codex",

  async refresh(credentials, { signal, timeoutMs } = {}) {
    if (!credentials.refreshToken) throw configurationError("This Codex account has no refresh token.", "codex");
    const response = await assertOk(await fetchWithTimeout(CODEX_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CODEX_OAUTH.clientId,
        refresh_token: credentials.refreshToken,
        scope: CODEX_OAUTH.scope,
      }),
    }, { signal, timeoutMs: Math.min(timeoutMs || 30000, 30000), provider: "codex" }), "codex");
    const tokens = await response.json();
    return { ...refreshedCredentialSet(credentials, tokens), idToken: tokens.id_token || credentials.idToken };
  },

  async generate({ model, prompt, referenceImages = [], aspectRatio, credentials, signal, timeoutMs }) {
    if (!credentials.accessToken) throw configurationError("Codex requires an OAuth access token.", "codex");
    const sizeMap = { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" };
    const imageTool = { type: "image_generation", output_format: "png" };
    if (aspectRatio) imageTool.size = sizeMap[aspectRatio];
    const body = {
      model: model.endsWith("-image") ? model.slice(0, -6) : model,
      instructions: "",
      input: [{ type: "message", role: "user", content: contentParts(prompt, referenceImages) }],
      tools: [imageTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: crypto.randomUUID(),
      stream: true,
      store: false,
      reasoning: null,
    };
    const response = await assertOk(await fetchWithTimeout(RESPONSES_URL, {
      method: "POST",
      headers: headers(credentials),
      body: JSON.stringify(body),
    }, { signal, timeoutMs, provider: "codex" }), "codex");
    return { ...(await parseCodexImageStream(response, { signal })), model };
  },

  async listTextModels({ credentials }) {
    if (!credentials.accessToken) throw configurationError("Codex requires an OAuth access token.", "codex");
    return ["gpt-5.5", "gpt-5.4", "gpt-5.3"];
  },

  async enhance({ model, systemPrompt, prompt, credentials, signal, timeoutMs }) {
    if (!credentials.accessToken) throw configurationError("Codex requires an OAuth access token.", "codex");
    const response = await assertOk(await fetchWithTimeout(RESPONSES_URL, {
      method: "POST",
      headers: headers(credentials),
      body: JSON.stringify({
        model: model.endsWith("-image") ? model.slice(0, -6) : model,
        instructions: systemPrompt,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }],
        tools: [],
        tool_choice: "none",
        stream: true,
        store: false,
        reasoning: null,
      }),
    }, { signal, timeoutMs, provider: "codex" }), "codex");
    return { text: await parseCodexTextStream(response, { signal }), model };
  },

  async health({ credentials, signal, timeoutMs = 15000 }) {
    if (!credentials.accessToken) throw configurationError("Codex requires an OAuth access token.", "codex");
    await assertOk(await fetchWithTimeout(USAGE_URL, { headers: headers(credentials) }, { signal, timeoutMs, provider: "codex" }), "codex");
    return { ok: true, models: [] };
  },
};
