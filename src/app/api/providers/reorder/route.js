import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function PUT(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    const connections = getRuntime().database.reorderConnections(body.provider, body.orderedIds);
    return Response.json({ connections });
  } catch (error) {
    return errorResponse(error);
  }
}
