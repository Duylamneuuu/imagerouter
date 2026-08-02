import { ImageRouterError } from "@server/image/errors.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const { id } = await params;
    const body = await readJson(request);
    const connection = getRuntime().database.updateConnection(id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    return Response.json({ connection });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const { id } = await params;
    if (!getRuntime().database.removeConnection(id)) throw new ImageRouterError("Connection not found.", { code: "NOT_FOUND", status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
