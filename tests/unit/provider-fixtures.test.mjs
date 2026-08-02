import assert from "node:assert/strict";
import test from "node:test";

import { antigravityAdapter, resolveAntigravityProjectId } from "../../server/providers/antigravity/index.mjs";
import { parseCodexImageStream, parseCodexTextStream } from "../../server/providers/codex/index.mjs";
import { assertImageBytes, MAX_IMAGE_BYTES } from "../../server/providers/shared.mjs";
import { xaiAdapter } from "../../server/providers/xai/index.mjs";

test("xAI adapter parses image JSON and forwards current Imagine fields", async (t) => {
  const image = Buffer.from("xai-image");
  let requestBody;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ data: [{ b64_json: image.toString("base64"), mime_type: "image/jpeg" }] });
  });
  const result = await xaiAdapter.generate({
    model: "grok-imagine-image-quality",
    prompt: "fixture",
    aspectRatio: "16:9",
    referenceImages: [],
    credentials: { apiKey: "xai-fixture-key" },
    timeoutMs: 1000,
  });
  assert.equal(requestBody.aspect_ratio, "16:9");
  assert.equal(requestBody.n, 1);
  assert.deepEqual(result.bytes, image);
  assert.equal(result.mimeType, "image/jpeg");
});

test("xAI text adapter extracts a Responses API result without storing it", async (t) => {
  let requestBody;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ output_text: '{"prompt":"A polished English prompt"}' });
  });
  const result = await xaiAdapter.enhance({ model: "latest", systemPrompt: "system", prompt: "fixture", credentials: { apiKey: "xai-fixture-key" }, timeoutMs: 1000 });
  assert.equal(result.text, '{"prompt":"A polished English prompt"}');
  assert.equal(requestBody.store, false);
});

test("Antigravity adapter parses inlineData fixture", async (t) => {
  const image = Buffer.from("antigravity-image");
  let envelope;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    envelope = JSON.parse(init.body);
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: image.toString("base64"), mimeType: "image/png" } }] } }] });
  });
  const result = await antigravityAdapter.generate({
    model: "gemini-3.1-flash-image",
    prompt: "fixture",
    aspectRatio: "1:1",
    referenceImages: ["data:image/png;base64,aW5wdXQ="],
    credentials: { accessToken: "token", projectId: "project" },
    timeoutMs: 1000,
  });
  assert.equal(envelope.requestType, "image_gen");
  assert.equal(envelope.request.contents[0].parts[0].inlineData.data, "aW5wdXQ=");
  assert.deepEqual(result.bytes, image);
});

test("Antigravity text adapter extracts a candidate response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"prompt":"A clean English prompt"}' }] } }] }));
  const result = await antigravityAdapter.enhance({ model: "gemini-3.1-flash", systemPrompt: "system", prompt: "fixture", credentials: { accessToken: "token", projectId: "project" }, timeoutMs: 1000 });
  assert.equal(result.text, '{"prompt":"A clean English prompt"}');
});

test("Antigravity provisions and extracts a Code Assist project when loadCodeAssist has none", async (t) => {
  const requests = [];
  let onboardCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith(":loadCodeAssist")) {
      return Response.json({ allowedTiers: [{ id: "free-tier", isDefault: true }] });
    }
    onboardCalls += 1;
    if (onboardCalls === 1) return Response.json({ done: false });
    return Response.json({ done: true, response: { cloudaicompanionProject: { id: "code-assist-project" } } });
  });

  const projectId = await resolveAntigravityProjectId(
    { accessToken: "token" },
    { timeoutMs: 1000, onboardDelayMs: 0, maxOnboardAttempts: 3 },
  );
  assert.equal(projectId, "code-assist-project");
  assert.equal(onboardCalls, 2);
  assert.equal(requests[1].body.tierId, "free-tier");
});

test("Antigravity uses a persisted-compatible project ID when onboarding completes without one", async (t) => {
  let onboardCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith(":loadCodeAssist")) {
      return Response.json({ allowedTiers: [{ id: "standard-tier", isDefault: true }] });
    }
    onboardCalls += 1;
    return Response.json({ done: true, response: { cloudaicompanionProject: {} } });
  });

  const projectId = await resolveAntigravityProjectId(
    { accessToken: "token" },
    { timeoutMs: 1000, onboardDelayMs: 0, maxOnboardAttempts: 3 },
  );

  assert.match(projectId, /^(useful|bright|swift|calm|bold)-(fuze|wave|spark|flow|core)-[0-9a-f]{5}$/);
  assert.equal(onboardCalls, 1);
});

test("Codex SSE parser extracts response.output_item.done image result", async () => {
  const image = Buffer.from("codex-image");
  const sse = [
    "event: response.created\ndata: {}\n\n",
    `event: response.output_item.done\ndata: ${JSON.stringify({ item: { type: "image_generation_call", result: image.toString("base64") } })}\n\n`,
  ].join("");
  const result = await parseCodexImageStream(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
  assert.deepEqual(result.bytes, image);
  assert.equal(result.mimeType, "image/png");
});

test("Codex SSE parser extracts text deltas for the enhancer", async () => {
  const sse = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: '{"prompt":"A polished ' })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: 'English prompt"}' })}\n\n`,
  ].join("");
  const result = await parseCodexTextStream(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
  assert.equal(result, '{"prompt":"A polished English prompt"}');
});

test("provider image guard rejects decoded output larger than 32 MB", () => {
  assert.throws(
    () => assertImageBytes(Buffer.allocUnsafe(MAX_IMAGE_BYTES + 1), { provider: "xai" }),
    (error) => error.code === "IMAGE_TOO_LARGE" && error.retryable === false,
  );
});
