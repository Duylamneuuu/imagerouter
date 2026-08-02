import { ImageRouterError } from "../image/errors.mjs";
import { errorResponse, readJson } from "../security/http.mjs";
import { redactAttempts } from "../security/redaction.mjs";

function restInput(body) {
  if (body.n != null && Number(body.n) !== 1) {
    throw new ImageRouterError("ImageRouter v1 generates exactly one image per request.", { code: "INVALID_REQUEST", status: 400 });
  }
  const modelValue = body.model || "auto";
  return {
    prompt: body.prompt,
    provider: body.provider || (modelValue === "auto" ? "auto" : undefined),
    model: modelValue === "auto" ? undefined : modelValue,
    reference_images: body.reference_images || body.images || (body.image ? [body.image] : []),
    aspect_ratio: body.aspect_ratio,
    output_path: body.output_path,
    overwrite: body.overwrite === true,
    prompt_mode: body.prompt_mode,
    template_id: body.template_id,
  };
}

export async function handleImageGenerationRest(request, { service }) {
  try {
    const body = await readJson(request);
    const result = await service.generate(restInput(body), { signal: request.signal });
    const wantsBinary = body.response_format === "binary" || /^image\//i.test(request.headers.get("accept") || "");
    const headers = {
      "Cache-Control": "no-store",
      "X-ImageRouter-Provider": result.provider,
      "X-ImageRouter-Model": result.model,
      "X-ImageRouter-Fallback": String(result.fellBack),
      "X-ImageRouter-Prompt-Mode": result.promptPipeline?.mode || "raw",
      "X-ImageRouter-Template": result.promptPipeline?.selectedTemplate?.id || "",
      "X-ImageRouter-Enhancer": result.promptPipeline?.enhancer?.provider || "",
    };
    if (wantsBinary) {
      return new Response(result.bytes, {
        status: 200,
        headers: { ...headers, "Content-Type": result.mimeType, "Content-Length": String(result.bytes.length) },
      });
    }
    const responseItem = body.response_format === "url"
      ? { url: `data:${result.mimeType};base64,${result.bytes.toString("base64")}` }
      : { b64_json: result.bytes.toString("base64") };
    return Response.json({
      created: Math.floor(Date.now() / 1000),
      data: [responseItem],
      router: {
        provider: result.provider,
        model: result.model,
        mime_type: result.mimeType,
        output_path: result.outputPath,
        fallback: result.fellBack,
        attempts: redactAttempts(result.attempts),
        prompt_pipeline: result.promptPipeline,
      },
    }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
