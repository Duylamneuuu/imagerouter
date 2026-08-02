import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const { provider } = await params;
    const body = await readJson(request).catch(() => ({}));
    return Response.json(await getRuntime().oauth.start(provider, { label: body.label }));
  } catch (error) {
    return errorResponse(error);
  }
}
