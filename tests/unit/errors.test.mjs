import assert from "node:assert/strict";
import test from "node:test";

import { errorFromResponse } from "../../server/image/errors.mjs";

test("retry classification matches the bounded fallback policy", async () => {
  const rateLimit = await errorFromResponse(Response.json({ error: { message: "rate limit" } }, { status: 429 }), "xai");
  const capacity = await errorFromResponse(Response.json({ error: { message: "at capacity" } }, { status: 503 }), "codex");
  const invalid = await errorFromResponse(Response.json({ error: { message: "unsupported parameter" } }, { status: 400 }), "xai");
  const safety = await errorFromResponse(Response.json({ error: { message: "blocked by safety policy" } }, { status: 400 }), "xai");

  assert.deepEqual([rateLimit.code, rateLimit.retryable], ["RATE_LIMITED", true]);
  assert.deepEqual([capacity.code, capacity.retryable], ["CAPACITY", true]);
  assert.deepEqual([invalid.code, invalid.retryable], ["INVALID_REQUEST", false]);
  assert.deepEqual([safety.code, safety.retryable], ["SAFETY_REJECTION", false]);
});
