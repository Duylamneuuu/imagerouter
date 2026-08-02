import { getRuntime } from "@server/runtime.mjs";
import { errorResponse, hostGuard } from "@server/security/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  const rejected = hostGuard(request);
  if (rejected) return rejected;
  try {
    const params = new URL(request.url).searchParams;
    const templateId = params.get("id");
    if (templateId) {
      const template = getRuntime().service.getPromptTemplate(templateId);
      if (!template) return Response.json({ error: { code: "NOT_FOUND", message: "Prompt template not found." } }, { status: 404 });
      return Response.json({ state: "ready", template }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = getRuntime().service.searchPromptTemplates({
      query: params.get("q") || "",
      provider: params.get("provider") || "auto",
      source: params.get("source") || "all",
      referenceImageCount: Number(params.get("reference_images") || 0),
      limit: Number(params.get("limit") || 3),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
