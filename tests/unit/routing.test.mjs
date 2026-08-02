import assert from "node:assert/strict";
import test from "node:test";

import { ImageRouterError } from "../../server/image/errors.mjs";
import { PromptPipeline } from "../../server/image/prompt-pipeline.mjs";
import { ImageRouter } from "../../server/image/router.mjs";
import { createTestDatabase, successImage } from "../helpers.mjs";

function addAccount(database, provider, label, token, extra = {}) {
  return database.addConnection({
    provider,
    label,
    authType: "token",
    credentials: { accessToken: token, ...extra },
  });
}

test("auto tries accounts by priority before moving providers", async (t) => {
  const { database } = await createTestDatabase(t);
  addAccount(database, "xai", "primary", "one");
  addAccount(database, "xai", "secondary", "two");
  let antigravityCalls = 0;
  const adapters = {
    xai: {
      async generate({ credentials, model }) {
        if (credentials.accessToken === "one") throw new ImageRouterError("quota", { code: "RATE_LIMITED", status: 429, retryable: true, provider: "xai" });
        return successImage(model);
      },
    },
    antigravity: { async generate() { antigravityCalls += 1; return successImage(); } },
    codex: { async generate() { return successImage(); } },
  };
  const result = await new ImageRouter({ database, adapters }).generate({ prompt: "fixture" });
  assert.equal(result.provider, "xai");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.accountLabel), ["primary", "secondary"]);
  assert.equal(result.fellBack, true);
  assert.equal(antigravityCalls, 0);
});

test("auto moves to the next route only for retryable errors", async (t) => {
  const { database } = await createTestDatabase(t);
  addAccount(database, "xai", "xAI", "one");
  addAccount(database, "antigravity", "AG", "two", { projectId: "project" });
  const calls = [];
  const router = new ImageRouter({
    database,
    adapters: {
      xai: { async generate() { calls.push("xai"); throw new ImageRouterError("network", { code: "NETWORK_ERROR", status: 502, retryable: true, provider: "xai" }); } },
      antigravity: { async generate({ model }) { calls.push("antigravity"); return successImage(model); } },
      codex: { async generate() { calls.push("codex"); return successImage(); } },
    },
  });
  const result = await router.generate({ prompt: "fixture" });
  assert.equal(result.provider, "antigravity");
  assert.deepEqual(calls, ["xai", "antigravity"]);
});

test("explicit provider never cross-falls back", async (t) => {
  const { database } = await createTestDatabase(t);
  addAccount(database, "xai", "xAI", "one");
  addAccount(database, "antigravity", "AG", "two", { projectId: "project" });
  let antigravityCalls = 0;
  const router = new ImageRouter({
    database,
    adapters: {
      xai: { async generate() { throw new ImageRouterError("capacity", { code: "CAPACITY", status: 503, retryable: true, provider: "xai" }); } },
      antigravity: { async generate() { antigravityCalls += 1; return successImage(); } },
    },
  });
  await assert.rejects(router.generate({ prompt: "fixture", provider: "xai" }), (error) => error.code === "CAPACITY" && error.attempts.length === 1);
  assert.equal(antigravityCalls, 0);
});

test("non-retryable safety errors stop auto routing", async (t) => {
  const { database } = await createTestDatabase(t);
  addAccount(database, "xai", "xAI", "one");
  addAccount(database, "antigravity", "AG", "two", { projectId: "project" });
  let fallbackCalls = 0;
  const router = new ImageRouter({
    database,
    adapters: {
      xai: { async generate() { throw new ImageRouterError("blocked", { code: "SAFETY_REJECTION", status: 400, provider: "xai" }); } },
      antigravity: { async generate() { fallbackCalls += 1; return successImage(); } },
    },
  });
  await assert.rejects(router.generate({ prompt: "fixture" }), (error) => error.code === "SAFETY_REJECTION");
  assert.equal(fallbackCalls, 0);
});

test("capability mismatch is skipped in auto and explicit in strict mode", async (t) => {
  const { database } = await createTestDatabase(t);
  database.updateRoutes([
    { provider: "codex", model: "gpt-5.5-image", enabled: true },
    { provider: "xai", model: "grok-imagine-image-quality", enabled: true },
    { provider: "antigravity", model: "gemini-3.1-flash-image", enabled: true },
  ]);
  addAccount(database, "xai", "xAI", "one");
  const router = new ImageRouter({ database, adapters: { xai: { async generate({ model }) { return successImage(model); } } } });
  const result = await router.generate({ prompt: "fixture", aspect_ratio: "16:9" });
  assert.equal(result.provider, "xai");
  assert.equal(result.attempts[0].code, "CAPABILITY_MISMATCH");
  await assert.rejects(router.generate({ prompt: "fixture", provider: "codex", aspect_ratio: "16:9" }), (error) => error.code === "CAPABILITY_MISMATCH");
});

test("provider prompt limits are capability errors", async (t) => {
  const { database } = await createTestDatabase(t);
  addAccount(database, "xai", "xAI", "one");
  const router = new ImageRouter({
    database,
    adapters: { xai: { async generate({ model }) { return successImage(model); } } },
  });
  await assert.rejects(
    router.generate({ prompt: "x".repeat(1025), provider: "xai" }),
    (error) => error.code === "CAPABILITY_MISMATCH" && /1024/.test(error.message),
  );
});

test("expired credentials refresh once and persist before generation", async (t) => {
  const { database } = await createTestDatabase(t);
  const account = addAccount(database, "xai", "OAuth", "expired", { refreshToken: "refresh", expiresAt: Date.now() - 1000 });
  let refreshCalls = 0;
  const router = new ImageRouter({
    database,
    adapters: {
      xai: {
        async refresh(credentials) { refreshCalls += 1; return { ...credentials, accessToken: "fresh", expiresAt: Date.now() + 3600000 }; },
        async generate({ credentials, model }) { assert.equal(credentials.accessToken, "fresh"); return successImage(model); },
      },
    },
  });
  await router.generate({ prompt: "fixture", provider: "xai" });
  assert.equal(refreshCalls, 1);
  assert.equal(database.getConnection(account.id, { includeCredentials: true }).credentials.accessToken, "fresh");
});

test("provider preparation repairs and persists missing credentials before generation", async (t) => {
  const { database } = await createTestDatabase(t);
  const account = addAccount(database, "antigravity", "OAuth", "token");
  let prepareCalls = 0;
  const router = new ImageRouter({
    database,
    adapters: {
      antigravity: {
        async prepare({ credentials }) {
          prepareCalls += 1;
          assert.equal(credentials.projectId, undefined);
          return { credentialPatch: { projectId: "repaired-project" } };
        },
        async generate({ credentials, model }) {
          assert.equal(credentials.projectId, "repaired-project");
          return successImage(model);
        },
      },
    },
  });
  await router.generate({ prompt: "fixture", provider: "antigravity" });
  assert.equal(prepareCalls, 1);
  assert.equal(database.getConnection(account.id, { includeCredentials: true }).credentials.projectId, "repaired-project");
});

test("PromptPipeline preserves the prompt byte-for-byte", async () => {
  const prompt = "  exact prompt\nwith spacing — unchanged  ";
  const output = await new PromptPipeline().run({ prompt, provider: "auto" });
  assert.equal(output.prompt, prompt);
  assert.deepEqual(output.promptPipeline, { mode: "raw", stages: [] });
});
