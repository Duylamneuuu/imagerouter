import { getMcpHttpHandler } from "@server/mcp/http.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { bearerGuard, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request) {
  const rejectedHost = hostGuard(request);
  if (rejectedHost) return rejectedHost;
  const runtimeState = getRuntime();
  const rejectedToken = bearerGuard(request, runtimeState.database.getHttpToken());
  if (rejectedToken) return rejectedToken;
  return getMcpHttpHandler().fetch(request, {
    authInfo: { token: "[validated]", clientId: "local", scopes: ["images:generate", "status:read"] },
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
