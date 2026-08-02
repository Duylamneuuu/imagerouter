import { getRuntime } from "@server/runtime.mjs";
import { hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
  return Response.json({ activity: getRuntime().database.listActivity(limit) }, { headers: { "Cache-Control": "no-store" } });
}
