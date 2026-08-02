import assert from "node:assert/strict";
import test from "node:test";

import { ImageRouterError } from "../../server/image/errors.mjs";
import { ImageRouterService } from "../../server/image/service.mjs";
import { bearerGuard, errorResponse, hostGuard } from "../../server/security/http.mjs";
import { redactObject, redactText } from "../../server/security/redaction.mjs";
import { createTestDatabase } from "../helpers.mjs";

test("HTTP guards reject hostile Host and missing or invalid bearer tokens", () => {
  assert.equal(hostGuard(new Request("http://evil.example/mcp", { headers: { Host: "evil.example" } })).status, 403);
  assert.equal(hostGuard(new Request("http://evil.example/mcp", { headers: { Host: "evil.example", "X-Forwarded-Host": "127.0.0.1" } })).status, 403);
  assert.equal(hostGuard(new Request("http://127.0.0.1/mcp", { headers: { Host: "127.0.0.1:20127" } })), null);
  assert.equal(bearerGuard(new Request("http://127.0.0.1/mcp"), "secret").status, 401);
  assert.equal(bearerGuard(new Request("http://127.0.0.1/mcp", { headers: { Authorization: "Bearer wrong" } }), "secret").status, 403);
  assert.equal(bearerGuard(new Request("http://127.0.0.1/mcp", { headers: { Authorization: "Bearer secret" } }), "secret"), null);
});

test("redaction removes credential values and credential-shaped fields", () => {
  const secret = "xai-secret-value-123456";
  assert.doesNotMatch(redactText(`Authorization: Bearer ${secret}`, [secret]), new RegExp(secret));
  assert.deepEqual(redactObject({ accessToken: secret, nested: { api_key: secret, safe: "ok" } }), {
    accessToken: "[REDACTED]",
    nested: { api_key: "[REDACTED]", safe: "ok" },
  });
});

test("HTTP error responses redact messages and attempt details", async () => {
  const error = new ImageRouterError("Authorization: Bearer secret-value-123456");
  error.attempts = [{ message: "Bearer attempt-secret-123456" }];
  const response = errorResponse(error);
  const serialized = JSON.stringify(await response.json());
  assert.doesNotMatch(serialized, /secret-value|attempt-secret/);
  assert.match(serialized, /REDACTED/);
});

test("HTTP error responses preserve typed errors from another module realm", async () => {
  const response = errorResponse({
    name: "ImageRouterError",
    message: "Antigravity requires a Code Assist project ID.",
    code: "CONFIGURATION_ERROR",
    status: 400,
    retryable: false,
    provider: "antigravity",
    attempts: [],
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "CONFIGURATION_ERROR");
});

test("public status and SQLite schema contain no credential, prompt or image payload", async (t) => {
  const { database } = await createTestDatabase(t);
  database.addConnection({ provider: "xai", label: "private", authType: "api_key", credentials: { apiKey: "xai-secret-value-123456" } });
  const service = new ImageRouterService({ database, router: {} });
  const serialized = JSON.stringify(service.getStatus());
  assert.doesNotMatch(serialized, /xai-secret-value-123456/);
  assert.doesNotMatch(serialized, /apiKey|accessToken|refreshToken/);
  const schema = database.db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.sql).join("\n");
  assert.doesNotMatch(schema, /\bprompt\b|image_base64|image_blob|image_data/i);
});

test("status counts only enabled healthy accounts and reports the active HTTP port", async (t) => {
  const previousPort = process.env.IMAGEROUTER_ACTIVE_PORT;
  t.after(() => {
    if (previousPort === undefined) delete process.env.IMAGEROUTER_ACTIVE_PORT;
    else process.env.IMAGEROUTER_ACTIVE_PORT = previousPort;
  });
  process.env.IMAGEROUTER_ACTIVE_PORT = "21234";
  const { database } = await createTestDatabase(t);
  database.updateSettings({ httpPort: 22345 });
  const account = database.addConnection({ provider: "xai", label: "disabled healthy", authType: "api_key", credentials: { apiKey: "secret" } });
  database.updateConnectionHealth(account.id, { status: "healthy" });
  database.updateConnection(account.id, { enabled: false });
  const service = new ImageRouterService({ database, router: {} });
  const status = service.getStatus();
  assert.equal(status.healthyAccounts, 0);
  assert.equal(status.enabledAccounts, 0);
  assert.equal(status.mcp.port, 21234);
  assert.equal(status.mcp.configuredPort, 22345);
  assert.equal(status.mcp.restartRequired, true);
});
