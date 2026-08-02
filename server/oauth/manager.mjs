import crypto from "node:crypto";
import http from "node:http";

import { ImageRouterError } from "../image/errors.mjs";
import { ANTIGRAVITY_OAUTH, resolveAntigravityProjectId } from "../providers/antigravity/index.mjs";
import { CODEX_OAUTH } from "../providers/codex/index.mjs";
import { decodeJwtPayload, fetchWithTimeout } from "../providers/shared.mjs";
import { XAI_OAUTH, discoverXaiOAuthEndpoints } from "../providers/xai/index.mjs";
import { redactText } from "../security/redaction.mjs";

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function base64Url(buffer) {
  return buffer.toString("base64url");
}

function pkce(bytes = 64) {
  const verifier = base64Url(crypto.randomBytes(bytes));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function html(message, success) {
  const color = success ? "#1648d8" : "#a73232";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ImageRouter OAuth</title></head><body style="font:16px system-ui;background:#f6f7fb;color:#20242c;padding:48px"><main style="max-width:560px;border-top:3px solid ${color};padding-top:24px"><h1 style="font-size:24px">${success ? "Account connected" : "Connection failed"}</h1><p>${message.replace(/[<>&]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[value])}</p><p>You can close this window.</p></main></body></html>`;
}

async function exchangeForm(url, fields, provider) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields),
  }, { timeoutMs: 30000, provider });
  if (!response.ok) throw new Error(`${provider} token exchange returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function mapIdentity(tokens) {
  const payload = decodeJwtPayload(tokens.id_token || tokens.access_token);
  return payload.email || payload.preferred_username || payload.sub || null;
}

async function completeXai(flow, code) {
  const { tokenUrl } = await discoverXaiOAuthEndpoints();
  const tokens = await exchangeForm(tokenUrl, {
    grant_type: "authorization_code",
    client_id: XAI_OAUTH.clientId,
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier,
  }, "xai");
  return {
    authType: "oauth",
    label: flow.label || mapIdentity(tokens) || "xAI OAuth",
    credentials: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
      email: mapIdentity(tokens),
    },
  };
}

async function completeCodex(flow, code) {
  const tokens = await exchangeForm(CODEX_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: CODEX_OAUTH.clientId,
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier,
  }, "codex");
  const payload = decodeJwtPayload(tokens.id_token);
  const auth = payload?.["https://api.openai.com/auth"] || {};
  return {
    authType: "oauth",
    label: flow.label || payload.email || "Codex OAuth",
    credentials: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
      email: payload.email || null,
      chatgptAccountId: auth.chatgpt_account_id || null,
      chatgptPlanType: auth.chatgpt_plan_type || null,
    },
  };
}

async function completeAntigravity(flow, code) {
  const tokens = await exchangeForm(ANTIGRAVITY_OAUTH.tokenUrl, {
    grant_type: "authorization_code",
    client_id: ANTIGRAVITY_OAUTH.clientId,
    client_secret: ANTIGRAVITY_OAUTH.clientSecret,
    code,
    redirect_uri: flow.redirectUri,
  }, "antigravity");
  const credentials = { accessToken: tokens.access_token };
  const [userResponse, projectId] = await Promise.all([
    fetchWithTimeout(ANTIGRAVITY_OAUTH.userInfoUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } }, { timeoutMs: 30000, provider: "antigravity" }),
    resolveAntigravityProjectId(credentials, { timeoutMs: 30000 }),
  ]);
  const user = userResponse.ok ? await userResponse.json() : {};
  return {
    authType: "oauth",
    label: flow.label || user.email || "Antigravity OAuth",
    credentials: {
      ...credentials,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
      email: user.email || null,
      projectId,
    },
  };
}

export class OAuthManager {
  constructor({ database }) {
    this.database = database;
    this.flows = new Map();
  }

  async start(provider, { label } = {}) {
    if (!new Set(["xai", "codex", "antigravity"]).has(provider)) {
      throw new ImageRouterError("Unsupported OAuth provider.", { code: "INVALID_REQUEST", status: 400 });
    }
    const id = crypto.randomUUID();
    const state = base64Url(crypto.randomBytes(32));
    const challenge = provider === "antigravity" ? null : pkce(provider === "xai" ? 96 : 64);
    const fixedPort = provider === "xai" ? XAI_OAUTH.port : provider === "codex" ? CODEX_OAUTH.port : 0;
    const callbackPath = provider === "xai" ? XAI_OAUTH.callbackPath : provider === "codex" ? CODEX_OAUTH.callbackPath : "/callback";
    const flow = { id, provider, state, label, verifier: challenge?.verifier, status: "pending", startedAt: Date.now(), server: null };

    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url || "/", `http://127.0.0.1`);
      if (url.pathname !== callbackPath) {
        response.writeHead(404).end("Not found");
        return;
      }
      try {
        if (url.searchParams.get("state") !== state) throw new Error("OAuth state did not match");
        const code = url.searchParams.get("code");
        const upstreamError = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (upstreamError) throw new Error(upstreamError);
        if (!code) throw new Error("OAuth callback did not include a code");
        const mapped = provider === "xai"
          ? await completeXai(flow, code)
          : provider === "codex"
            ? await completeCodex(flow, code)
            : await completeAntigravity(flow, code);
        const connection = this.database.addConnection({ provider, ...mapped });
        flow.status = "complete";
        flow.connectionId = connection.id;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html(`${connection.label} is ready.`, true));
      } catch (error) {
        flow.status = "error";
        flow.error = redactText(error?.message || error).slice(0, 300);
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(html(flow.error, false));
      } finally {
        setImmediate(() => server.close());
      }
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(fixedPort, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    flow.server = server;
    flow.redirectUri = provider === "codex"
      ? `http://localhost:${port}${callbackPath}`
      : `http://127.0.0.1:${port}${callbackPath}`;
    this.flows.set(id, flow);

    const timer = setTimeout(() => {
      if (flow.status === "pending") {
        flow.status = "error";
        flow.error = "OAuth flow expired after five minutes.";
        server.close();
      }
    }, FLOW_TIMEOUT_MS);
    timer.unref?.();

    let authUrl;
    if (provider === "xai") {
      const { authorizeUrl } = await discoverXaiOAuthEndpoints();
      authUrl = new URL(authorizeUrl);
      Object.entries({
        response_type: "code",
        client_id: XAI_OAUTH.clientId,
        redirect_uri: flow.redirectUri,
        scope: XAI_OAUTH.scope,
        code_challenge: challenge.challenge,
        code_challenge_method: "S256",
        state,
        nonce: base64Url(crypto.randomBytes(16)),
        plan: "generic",
        referrer: "imagerouter",
      }).forEach(([key, value]) => authUrl.searchParams.set(key, value));
    } else if (provider === "codex") {
      authUrl = new URL(CODEX_OAUTH.authorizeUrl);
      Object.entries({
        response_type: "code",
        client_id: CODEX_OAUTH.clientId,
        redirect_uri: flow.redirectUri,
        scope: CODEX_OAUTH.scope,
        code_challenge: challenge.challenge,
        code_challenge_method: "S256",
        state,
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "codex_cli_rs",
      }).forEach(([key, value]) => authUrl.searchParams.set(key, value));
    } else {
      authUrl = new URL(ANTIGRAVITY_OAUTH.authorizeUrl);
      Object.entries({
        client_id: ANTIGRAVITY_OAUTH.clientId,
        response_type: "code",
        redirect_uri: flow.redirectUri,
        scope: ANTIGRAVITY_OAUTH.scopes.join(" "),
        state,
        access_type: "offline",
        prompt: "consent",
      }).forEach(([key, value]) => authUrl.searchParams.set(key, value));
    }

    return { id, provider, authorizationUrl: authUrl.toString(), expiresInMs: FLOW_TIMEOUT_MS };
  }

  status(id) {
    const flow = this.flows.get(id);
    if (!flow) return null;
    return {
      id: flow.id,
      provider: flow.provider,
      status: flow.status,
      connectionId: flow.connectionId || null,
      error: flow.error || null,
    };
  }
}
