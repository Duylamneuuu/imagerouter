import { handleImageGenerationRest } from "@server/rest/images.mjs";
import { getRuntime } from "@server/runtime.mjs";
import { bearerGuard, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const rejectedHost = hostGuard(request);
  if (rejectedHost) return rejectedHost;
  const runtimeState = getRuntime();
  const rejectedToken = bearerGuard(request, runtimeState.database.getHttpToken());
  if (rejectedToken) return rejectedToken;
  return handleImageGenerationRest(request, { service: runtimeState.service });
}
