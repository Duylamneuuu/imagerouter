import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  return Response.json({ routes: getRuntime().service.getEnhancerRoutes() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    return Response.json({ routes: getRuntime().service.updateEnhancerRoutes(body.routes) });
  } catch (error) {
    return errorResponse(error);
  }
}
