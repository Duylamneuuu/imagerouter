import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard, readJson } from "@server/security/http.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const body = await readJson(request);
    const result = await getRuntime().service.generate(body, { signal: request.signal });
    return Response.json({
      image: result.bytes.toString("base64"),
      mimeType: result.mimeType,
      provider: result.provider,
      model: result.model,
      fellBack: result.fellBack,
      attempts: result.attempts,
      durationMs: result.durationMs,
      promptPipeline: result.promptPipeline,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
