import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const { id } = await params;
    const result = await getRuntime().service.testConnection(id, { signal: request.signal });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
