import { ImageRouterError } from "@server/image/errors.mjs";
import { isProviderId } from "@server/config.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateCredentials(provider, authType, raw = {}) {
  if (provider === "xai" && authType === "api_key") {
    if (typeof raw.apiKey !== "string" || raw.apiKey.length < 8) throw new ImageRouterError("Enter a valid xAI API key.", { code: "INVALID_REQUEST", status: 400 });
    return { apiKey: raw.apiKey };
  }
  if (typeof raw.accessToken !== "string" || raw.accessToken.length < 8) {
    throw new ImageRouterError("Enter a valid access token.", { code: "INVALID_REQUEST", status: 400 });
  }
  const credentials = {
    accessToken: raw.accessToken,
    refreshToken: typeof raw.refreshToken === "string" && raw.refreshToken ? raw.refreshToken : undefined,
    idToken: typeof raw.idToken === "string" && raw.idToken ? raw.idToken : undefined,
    expiresAt: Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : undefined,
  };
  if (provider === "antigravity") {
    if (typeof raw.projectId !== "string" || !raw.projectId.trim()) throw new ImageRouterError("Antigravity requires a project ID.", { code: "INVALID_REQUEST", status: 400 });
    credentials.projectId = raw.projectId.trim();
  }
  if (provider === "codex" && typeof raw.chatgptAccountId === "string" && raw.chatgptAccountId) {
    credentials.chatgptAccountId = raw.chatgptAccountId;
  }
  return credentials;
}

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  return Response.json({ connections: getRuntime().database.listConnections() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    const provider = String(body.provider || "").toLowerCase();
    if (!isProviderId(provider)) throw new ImageRouterError("Unsupported provider.", { code: "INVALID_REQUEST", status: 400 });
    const allowedAuth = provider === "xai" ? new Set(["api_key", "oauth", "token"]) : new Set(["oauth", "token"]);
    if (!allowedAuth.has(body.authType)) throw new ImageRouterError("Unsupported authentication type.", { code: "INVALID_REQUEST", status: 400 });
    const credentials = validateCredentials(provider, body.authType, body.credentials);
    const connection = getRuntime().database.addConnection({
      provider,
      label: body.label,
      authType: body.authType,
      credentials,
    });
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
