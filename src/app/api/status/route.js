import { getRuntime } from "@server/runtime.mjs";
import { hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  return Response.json(getRuntime().service.getStatus(), { headers: { "Cache-Control": "no-store" } });
}
