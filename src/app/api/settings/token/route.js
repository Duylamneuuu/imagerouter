import { getRuntime } from "@server/runtime.mjs";
import { hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";

export function POST(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  return Response.json({ httpToken: getRuntime().database.rotateHttpToken() }, { headers: { "Cache-Control": "no-store" } });
}
