import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  const runtimeState = getRuntime();
  return Response.json({
    routes: runtimeState.database.getRoutes(),
    fallbackEnabled: runtimeState.database.getSetting("fallback_enabled", "true") !== "false",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    const runtimeState = getRuntime();
    const routes = runtimeState.database.updateRoutes(body.routes);
    if (typeof body.fallbackEnabled === "boolean") runtimeState.database.updateSettings({ fallbackEnabled: body.fallbackEnabled });
    return Response.json({ routes, fallbackEnabled: runtimeState.database.getSetting("fallback_enabled") !== "false" });
  } catch (error) {
    return errorResponse(error);
  }
}
