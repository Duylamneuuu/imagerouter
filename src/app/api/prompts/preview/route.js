import { getRuntime } from "@server/runtime.mjs";
import { inlinePreviews } from "@server/prompt/preview.mjs";
import { errorResponse, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const url = new URL(request.url).searchParams.get("url");
    const status = getRuntime().service.getPromptStatus();
    const [block] = await inlinePreviews([url], { signal: request.signal, allowedHosts: status.previewHosts || [] });
    if (!block) return Response.json({ error: { code: "PREVIEW_UNAVAILABLE", message: "Preview is unavailable or not allowed by the bundled snapshot." } }, { status: 404 });
    return new Response(Buffer.from(block.data, "base64"), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": block.mimeType,
        "Content-Length": String(Buffer.byteLength(block.data, "base64")),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
