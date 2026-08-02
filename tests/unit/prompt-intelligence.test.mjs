import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ImageRouterDatabase } from "../../server/db/index.mjs";
import { ImageRouterError } from "../../server/image/errors.mjs";
import { PromptPipeline } from "../../server/image/prompt-pipeline.mjs";
import { PromptLibrary } from "../../server/prompt/index.mjs";
import { compileTemplatePrompt } from "../../server/prompt/compiler.mjs";
import { EnhancerRouter } from "../../server/prompt/enhancer.mjs";
import { inlinePreviews, validatePreviewUrl } from "../../server/prompt/preview.mjs";
import { normalizePromptPack, validatePromptPack, validatePromptRecord } from "../../server/prompt/records.mjs";

async function tempDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("prompt library deduplicates content while preserving source provenance and filters references", async (t) => {
  const directory = await tempDirectory("imagerouter-prompts-");
  const library = new PromptLibrary({ dataDirectory: directory, snapshotDirectory: path.join(directory, "missing") });
  t.after(async () => { library.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const records = [
    ...normalizePromptPack([{ id: 1, title: "Product poster", description: "A product launch", content: "A precise product launch poster with cobalt ink", sourceMedia: ["https://youmind.com/sample.png"], needReferenceImages: false, author: { name: "A" } }], { packId: "nano-banana-pro", packMeta: { license: "CC BY 4.0" } }),
    ...normalizePromptPack([{ id: 2, title: "Same poster", content: "A precise product launch poster with cobalt ink", sourceMedia: ["https://youmind.com/other.png"], needReferenceImages: false, author: { name: "B" } }], { packId: "gpt-image-2", packMeta: { license: "CC BY 4.0" } }),
    ...normalizePromptPack([{ id: 3, title: "Reference portrait", content: "A portrait based on the reference image", needReferenceImages: true }], { packId: "gpt-image-2" }),
  ];
  library.rebuildFromRecords(records, { updatedAt: "2026-08-02T00:00:00.000Z", packs: [{ id: "nano-banana-pro" }, { id: "gpt-image-2" }] });
  assert.equal(library.getStatus().totalTemplates, 2);
  const result = library.search({ query: "product launch poster", provider: "codex", referenceImageCount: 0, limit: 3 });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sources.length, 2);
  assert.equal(result.results[0].previewUrls.length, 2);
  assert.equal(result.results[0].sources[0].packId, "gpt-image-2");
  assert.equal(library.search({ query: "reference portrait", referenceImageCount: 0 }).results.length, 0);
  assert.equal(library.search({ query: "reference portrait", referenceImageCount: 1 }).results.length, 1);
});

test("deterministic compiler keeps user intent and bounds template context", () => {
  const userPrompt = "Use the exact words \"ImageRouter\" and \"local MCP\" on the poster.";
  const compiled = compileTemplatePrompt({ userPrompt, template: { prompt: "A very long template. ".repeat(100) }, maxPromptLength: 300 });
  assert.ok(compiled.prompt.includes(userPrompt));
  assert.ok(compiled.prompt.length <= 300);
  assert.equal(compiled.truncatedTemplate, true);
});

test("auto pipeline uses one enhancer result and exposes provenance without persistence", async () => {
  const template = {
    id: "tpl_fixture",
    title: "Fixture poster",
    prompt: "A clean editorial poster with precise typography",
    description: "Fixture",
    categories: ["poster"],
    sources: [{ packId: "gpt-image-2" }],
    attribution: "Prompts curated by YouMind",
  };
  const pipeline = new PromptPipeline({
    database: { getSetting(key, fallback) { return { prompt_mode_default: "auto", enhancer_enabled: "true", enhancer_timeout_ms: "30000" }[key] ?? fallback; } },
    library: {
      search() { return { state: "ready", results: [template], confidence: 0.9, searchMode: "local" }; },
      getTemplate() { return template; },
    },
    enhancerRouter: {
      async enhance() { return { ok: true, prompt: "A polished English product poster for ImageRouter, precise cobalt typography", provider: "xai", model: "latest", attempts: [] }; },
      async planQuery() { throw new Error("planner should not run for a confident English search"); },
    },
  });
  const prepared = await pipeline.run({ prompt: "A product poster for ImageRouter", provider: "auto", model: null, referenceImages: [], aspectRatio: null, outputPath: null, overwrite: false, promptMode: "auto", templateId: null }, { routes: [{ provider: "xai", model: "grok-imagine-image-quality", enabled: true }] });
  const routed = pipeline.compileForRoute(prepared, { provider: "xai", model: "grok-imagine-image-quality" });
  assert.equal(routed.prompt, "A polished English product poster for ImageRouter, precise cobalt typography");
  assert.equal(routed.promptPipeline.selectedTemplate.id, "tpl_fixture");
  assert.equal(routed.promptPipeline.enhancer.provider, "xai");
  assert.equal(routed.promptPipeline.finalPrompt, routed.prompt);
});

test("database defaults prompt mode to auto and stores only prompt metadata in activity", async (t) => {
  const directory = await tempDirectory("imagerouter-db-");
  const database = new ImageRouterDatabase({ filePath: ":memory:", dataDirectory: directory, vaultKey: Buffer.alloc(32, 9) });
  t.after(async () => { database.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(database.getSettings().promptModeDefault, "auto");
  assert.equal(database.getEnhancerRoutes().length, 3);
  const activity = database.recordActivity({ provider: "xai", model: "fixture", durationMs: 2, status: "success", promptMode: "auto", templateId: "tpl_fixture", templatePack: "gpt-image-2", enhancerProvider: "xai", enhancerModel: "latest", enhancerFallback: false });
  assert.equal(activity.promptMode, "auto");
  const listed = database.listActivity(1)[0];
  assert.equal(listed.templateId, "tpl_fixture");
  assert.doesNotMatch(JSON.stringify(listed), /product poster|ImageRouter prompt/i);
});

test("prompt record validation rejects incomplete source data", () => {
  assert.equal(validatePromptRecord({ id: 1 }).valid, false);
  assert.deepEqual(validatePromptPack([{ id: 1, content: "ok" }, { content: "missing id" }]).errors, [{ index: 1, errors: ["id is required"] }]);
});

test("corrupt prompt index degrades to unavailable without throwing", async (t) => {
  const directory = await tempDirectory("imagerouter-corrupt-prompts-");
  await fs.writeFile(path.join(directory, "prompts.sqlite"), "not a sqlite database");
  const library = new PromptLibrary({ dataDirectory: directory, snapshotDirectory: path.join(directory, "missing") });
  t.after(async () => { library.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const result = library.search({ query: "poster" });
  assert.equal(result.state, "unavailable");
  assert.equal(library.getStatus().reason, "INDEX_CORRUPT");
});

test("enhancer route tries the next provider after a retryable failure", async (t) => {
  const health = [];
  const database = {
    getEnhancerRoutes() { return [
      { provider: "xai", model: "latest", enabled: true, position: 0 },
      { provider: "antigravity", model: "gemini-3.1-flash", enabled: true, position: 1 },
    ]; },
    listConnections({ provider }) { return [{ id: `${provider}-1`, provider, label: `${provider} account`, credentials: { accessToken: "fixture" }, enabled: true }]; },
    updateConnectionHealth(id, patch) { health.push({ id, ...patch }); },
  };
  const router = new EnhancerRouter({ database, adapters: {
    xai: { async enhance() { throw new ImageRouterError("busy", { provider: "xai", code: "RATE_LIMITED", status: 429, retryable: true }); } },
    antigravity: { async enhance({ model }) { return { text: '{"prompt":"A polished English prompt"}', model }; } },
  } });
  const result = await router.enhance({ userPrompt: "fixture", template: null, timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "antigravity");
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["failed", "success"]);
  assert.equal(health.at(-1).status, "healthy");
  t.after(() => router.database = null);
});

test("non-English weak matches use planner then one remix call", async () => {
  let plannerCalls = 0;
  let remixCalls = 0;
  let searches = 0;
  const template = { id: "tpl_fixture", title: "Fixture", prompt: "Editorial composition", categories: [], sources: [] };
  const pipeline = new PromptPipeline({
    database: { getSetting(key, fallback) { return { prompt_mode_default: "auto", enhancer_enabled: "true", enhancer_timeout_ms: "30000" }[key] ?? fallback; } },
    library: {
      search() { searches += 1; return { state: "ready", results: searches > 1 ? [template] : [], confidence: searches > 1 ? 0.8 : 0.1, searchMode: "local" }; },
      getTemplate() { return template; },
    },
    enhancerRouter: {
      async planQuery() { plannerCalls += 1; return { ok: true, searchTerms: "cinematic portrait", provider: "xai", model: "latest", attempts: [] }; },
      async enhance() { remixCalls += 1; return { ok: true, prompt: "A cinematic English portrait", provider: "xai", model: "latest", attempts: [] }; },
    },
  });
  const result = await pipeline.run({ prompt: "Một bức chân dung điện ảnh", provider: "auto", model: null, referenceImages: [], aspectRatio: null, outputPath: null, overwrite: false, promptMode: "auto", templateId: null }, { routes: [{ provider: "xai", model: "grok-imagine-image-quality", enabled: true }] });
  assert.equal(plannerCalls, 1);
  assert.equal(remixCalls, 1);
  assert.equal(searches, 2);
  assert.equal(result.promptPipeline.stages.filter((stage) => stage.type === "query_planner").length, 1);
});

test("inline previews enforce snapshot hosts, MIME and the 5 MiB cap", async (t) => {
  assert.equal(validatePreviewUrl("http://youmind.com/image.png"), null);
  assert.equal(validatePreviewUrl("https://127.0.0.1/image.png"), null);
  assert.equal(validatePreviewUrl("https://cdn.example.com/image.png", { allowedHosts: ["example.com"] })?.hostname, "cdn.example.com");
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    return new Response(Buffer.alloc(128, 7), { headers: { "Content-Type": "image/png" } });
  });
  const blocks = await inlinePreviews(["https://cdn.example.com/image.png", "https://youmind.com/nope.png"], { allowedHosts: ["example.com"], maxBytes: 64 });
  assert.deepEqual(blocks, []);
});
