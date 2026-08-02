import { ImageRouterError } from "@server/image/errors.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  const reveal = new URL(request.url).searchParams.get("reveal") === "true";
  return Response.json(getRuntime().database.getSettings({ revealToken: reveal }), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    if (body.httpPort !== undefined && (!Number.isInteger(Number(body.httpPort)) || Number(body.httpPort) < 1 || Number(body.httpPort) > 65535)) {
      throw new ImageRouterError("Port must be an integer from 1 to 65535.", { code: "INVALID_REQUEST", status: 400 });
    }
    if (body.requestTimeoutMs !== undefined && (!Number.isInteger(Number(body.requestTimeoutMs)) || Number(body.requestTimeoutMs) < 1000 || Number(body.requestTimeoutMs) > 600000)) {
      throw new ImageRouterError("Timeout must be between 1,000 and 600,000 ms.", { code: "INVALID_REQUEST", status: 400 });
    }
    if (body.enhancerTimeoutMs !== undefined && (!Number.isInteger(Number(body.enhancerTimeoutMs)) || Number(body.enhancerTimeoutMs) < 1000 || Number(body.enhancerTimeoutMs) > 120000)) {
      throw new ImageRouterError("Enhancer timeout must be between 1,000 and 120,000 ms.", { code: "INVALID_REQUEST", status: 400 });
    }
    if (body.promptModeDefault !== undefined && !["raw", "auto"].includes(body.promptModeDefault)) {
      throw new ImageRouterError("Default prompt mode must be raw or auto. Use template_id per request for a selected template.", { code: "INVALID_REQUEST", status: 400 });
    }
    return Response.json(getRuntime().database.updateSettings({
      ...(body.httpPort !== undefined ? { httpPort: Number(body.httpPort) } : {}),
      ...(body.requestTimeoutMs !== undefined ? { requestTimeoutMs: Number(body.requestTimeoutMs) } : {}),
      ...(body.fallbackEnabled !== undefined ? { fallbackEnabled: Boolean(body.fallbackEnabled) } : {}),
      ...(body.promptModeDefault !== undefined ? { promptModeDefault: body.promptModeDefault } : {}),
      ...(body.enhancerEnabled !== undefined ? { enhancerEnabled: Boolean(body.enhancerEnabled) } : {}),
      ...(body.enhancerTimeoutMs !== undefined ? { enhancerTimeoutMs: Number(body.enhancerTimeoutMs) } : {}),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
