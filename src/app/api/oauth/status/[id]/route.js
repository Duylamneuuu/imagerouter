import { ImageRouterError } from "@server/image/errors.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const { id } = await params;
    const status = getRuntime().oauth.status(id);
    if (!status) throw new ImageRouterError("OAuth flow not found.", { code: "NOT_FOUND", status: 404 });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
