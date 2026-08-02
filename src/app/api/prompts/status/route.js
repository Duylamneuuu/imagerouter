import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    return Response.json(getRuntime().service.getPromptStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
