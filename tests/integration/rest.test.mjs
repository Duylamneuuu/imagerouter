import assert from "node:assert/strict";
import test from "node:test";

import { handleImageGenerationRest } from "../../server/rest/images.mjs";

const fixtureResult = {
  bytes: Buffer.from("rest-image"),
  mimeType: "image/png",
  provider: "xai",
  model: "grok-imagine-image-quality",
  outputPath: null,
  fellBack: true,
  attempts: [{ provider: "codex", status: "failed" }, { provider: "xai", status: "success" }],
};

test("REST compatibility returns OpenAI-style JSON with router metadata", async () => {
  const service = { async generate(input) { assert.equal(input.prompt, "fixture"); return fixtureResult; } };
  const response = await handleImageGenerationRest(new Request("http://127.0.0.1/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "auto", prompt: "fixture", response_format: "b64_json" }),
  }), { service });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(Buffer.from(payload.data[0].b64_json, "base64").toString(), "rest-image");
  assert.equal(payload.router.provider, "xai");
  assert.equal(payload.router.fallback, true);
});

test("REST compatibility returns raw image bytes when requested", async () => {
  const service = { async generate() { return fixtureResult; } };
  const response = await handleImageGenerationRest(new Request("http://127.0.0.1/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "image/png" },
    body: JSON.stringify({ model: "xai/grok-imagine-image-quality", prompt: "fixture" }),
  }), { service });
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "rest-image");
  assert.equal(response.headers.get("x-imagerouter-fallback"), "true");
});

test("REST rejects requests for more than one image", async () => {
  const service = { async generate() { throw new Error("should not run"); } };
  const response = await handleImageGenerationRest(new Request("http://127.0.0.1/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "auto", prompt: "fixture", n: 2 }),
  }), { service });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
});
