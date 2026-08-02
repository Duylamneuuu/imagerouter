import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { APP_VERSION } from "../config.mjs";
import { ImageRouterError, rehydrateImageRouterError } from "../image/errors.mjs";
import { MAX_REFERENCE_IMAGE_CHARACTERS } from "../image/validation.mjs";
import { inlinePreviews } from "../prompt/preview.mjs";
import { redactAttempts, redactText } from "../security/redaction.mjs";

export const generateImageInputSchema = z.object({
  prompt: z.string().min(1).describe("The image request or prompt. Auto mode can select and remix a local template."),
  provider: z.enum(["auto", "xai", "antigravity", "codex"]).optional().describe("Use auto for the configured route chain, or pin one provider."),
  model: z.string().min(1).optional().describe("Optional model override. provider/model pins the provider."),
  reference_images: z.array(z.string().min(1).max(MAX_REFERENCE_IMAGE_CHARACTERS)).max(8).optional().describe("HTTPS image URLs, data URIs, or base64 image data supported by the selected route."),
  aspect_ratio: z.string().regex(/^(?:auto|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/).optional(),
  output_path: z.string().min(1).optional().describe("Optional local path for one atomic image write."),
  overwrite: z.boolean().default(false),
  prompt_mode: z.enum(["raw", "auto", "template"]).optional().describe("raw preserves the input; auto selects a compatible template; template uses template_id."),
  template_id: z.string().min(1).optional().describe("Prompt template ID returned by search_prompt_templates when prompt_mode=template."),
});

export const searchPromptInputSchema = z.object({
  query: z.string().min(1).describe("Describe the image you need; search returns up to three prompt templates."),
  provider: z.enum(["auto", "xai", "antigravity", "codex"]).default("auto"),
  source: z.enum(["all", "nano-banana-pro", "gpt-image-2"]).default("all"),
  reference_image_count: z.number().int().min(0).max(8).default(0),
  limit: z.number().int().min(1).max(10).default(3),
  preview_mode: z.enum(["links", "inline", "none"]).default("links"),
});

const attemptSchema = z.object({
  provider: z.string(),
  model: z.string(),
  accountId: z.string().nullable(),
  accountLabel: z.string().nullable(),
  status: z.string(),
  code: z.string().nullable(),
  durationMs: z.number(),
  message: z.string().nullable(),
});

export const generateImageOutputSchema = z.object({
  success: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  mimeType: z.string().nullable(),
  outputPath: z.string().nullable(),
  fellBack: z.boolean(),
  fallbackCount: z.number(),
  attempts: z.array(attemptSchema),
  promptPipeline: z.any(),
  errorCode: z.string().nullable(),
});

export function createImageRouterMcpServer({ service }) {
  const server = new McpServer(
    { name: "imagerouter", version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions: "Use search_prompt_templates when an agent needs to inspect prompt options. Use generate_image with prompt_mode=auto for one-call search, enhancement and image generation; use prompt_mode=raw to preserve text exactly. Leave provider as auto to follow the configured image route chain. Set output_path only when a durable local file is required.",
    },
  );

  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description: "Generate exactly one image through ImageRouter. Auto mode uses the dashboard route order and only falls back for transient provider failures.",
      inputSchema: generateImageInputSchema,
      outputSchema: generateImageOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input, ctx) => {
      try {
        const result = await service.generate(input, { signal: ctx.mcpReq.signal });
        const structuredContent = {
          success: true,
          provider: result.provider,
          model: result.model,
          mimeType: result.mimeType,
          outputPath: result.outputPath,
          fellBack: result.fellBack,
          fallbackCount: result.fallbackCount,
          attempts: redactAttempts(result.attempts),
          promptPipeline: result.promptPipeline,
          errorCode: null,
        };
        const summary = result.outputPath
          ? `Generated one image with ${result.provider}/${result.model} using ${result.promptPipeline?.mode || "raw"} prompt mode and wrote it to ${result.outputPath}.`
          : `Generated one transient image with ${result.provider}/${result.model} using ${result.promptPipeline?.mode || "raw"} prompt mode; no file was written.`;
        return {
          content: [
            { type: "image", data: result.bytes.toString("base64"), mimeType: result.mimeType },
            { type: "text", text: summary },
          ],
          structuredContent,
        };
      } catch (caught) {
        const error = rehydrateImageRouterError(caught) || new ImageRouterError(caught?.message || "Image generation failed.");
        const publicMessage = redactText(error.message);
        const structuredContent = {
          success: false,
          provider: error.provider,
          model: null,
          mimeType: null,
          outputPath: input.output_path || null,
          fellBack: Boolean(error.fallbackCount),
          fallbackCount: error.fallbackCount || 0,
          attempts: redactAttempts(error.attempts),
          promptPipeline: null,
          errorCode: error.code,
        };
        return {
          content: [{ type: "text", text: `${error.code}: ${publicMessage}` }],
          structuredContent,
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "search_prompt_templates",
    {
      title: "Search prompt templates",
      description: "Search ImageRouter's bundled, local prompt packs and return up to three reusable image templates with provenance. Preview links are returned by default; request inline previews only when needed.",
      inputSchema: searchPromptInputSchema,
      outputSchema: z.object({ state: z.string(), query: z.string(), confidence: z.number(), searchMode: z.string(), results: z.array(z.any()) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input, ctx) => {
      const result = service.searchPromptTemplates({
        query: input.query,
        provider: input.provider,
        source: input.source,
        referenceImageCount: input.reference_image_count,
        limit: input.limit,
      });
      const previewBlocks = input.preview_mode === "inline"
        ? await inlinePreviews(result.results.flatMap((item) => item.previewUrls || []), { signal: ctx.mcpReq.signal, allowedHosts: service.getPromptStatus().previewHosts || [] })
        : [];
      const publicResults = input.preview_mode === "none"
        ? result.results.map(({ previewUrls: _previewUrls, ...item }) => item)
        : result.results;
      const summary = result.results.length
        ? `Found ${result.results.length} local prompt template${result.results.length === 1 ? "" : "s"}. Review the provenance and use template_id with generate_image when you want an exact selection.`
        : `No compatible local prompt templates were found. ImageRouter can still generate with prompt_mode=auto or raw.`;
      return {
        content: [{ type: "text", text: summary }, ...previewBlocks],
        structuredContent: { ...result, results: publicResults },
      };
    },
  );

  server.registerTool(
    "get_image_router_status",
    {
      title: "Get ImageRouter status",
      description: "Inspect route order, image model capabilities and redacted connector health. Credentials are never returned.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const status = service.getStatus();
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        structuredContent: status,
      };
    },
  );

  return server;
}
