import assert from "node:assert/strict";
import test from "node:test";

import { antigravityAdapter } from "../../server/providers/antigravity/index.mjs";
import { codexAdapter } from "../../server/providers/codex/index.mjs";
import { xaiAdapter } from "../../server/providers/xai/index.mjs";

const prompt = "A single cobalt circle centered on clean white paper, no text.";

function assertImage(result) {
  assert.ok(Buffer.isBuffer(result.bytes));
  assert.ok(result.bytes.length > 0);
  assert.match(result.mimeType, /^image\//);
}

test("real xAI image generation", {
  skip: !process.env.IMAGEROUTER_SMOKE_XAI_API_KEY,
  timeout: 180_000,
}, async () => {
  const result = await xaiAdapter.generate({
    model: process.env.IMAGEROUTER_SMOKE_XAI_MODEL || "grok-imagine-image-quality",
    prompt,
    referenceImages: [],
    aspectRatio: "1:1",
    credentials: { apiKey: process.env.IMAGEROUTER_SMOKE_XAI_API_KEY },
    timeoutMs: 150_000,
  });
  assertImage(result);
});

test("real Antigravity image generation", {
  skip: !(process.env.IMAGEROUTER_SMOKE_ANTIGRAVITY_ACCESS_TOKEN && process.env.IMAGEROUTER_SMOKE_ANTIGRAVITY_PROJECT_ID),
  timeout: 180_000,
}, async () => {
  const result = await antigravityAdapter.generate({
    model: process.env.IMAGEROUTER_SMOKE_ANTIGRAVITY_MODEL || "gemini-3.1-flash-image",
    prompt,
    referenceImages: [],
    aspectRatio: "1:1",
    credentials: {
      accessToken: process.env.IMAGEROUTER_SMOKE_ANTIGRAVITY_ACCESS_TOKEN,
      projectId: process.env.IMAGEROUTER_SMOKE_ANTIGRAVITY_PROJECT_ID,
    },
    timeoutMs: 150_000,
  });
  assertImage(result);
});

test("real Codex image generation", {
  skip: !process.env.IMAGEROUTER_SMOKE_CODEX_ACCESS_TOKEN,
  timeout: 180_000,
}, async () => {
  const result = await codexAdapter.generate({
    model: process.env.IMAGEROUTER_SMOKE_CODEX_MODEL || "gpt-5.5-image",
    prompt,
    referenceImages: [],
    aspectRatio: "1:1",
    credentials: {
      accessToken: process.env.IMAGEROUTER_SMOKE_CODEX_ACCESS_TOKEN,
      chatgptAccountId: process.env.IMAGEROUTER_SMOKE_CODEX_ACCOUNT_ID,
    },
    timeoutMs: 150_000,
  });
  assertImage(result);
});
