import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio launcher keeps stdout protocol-clean and completes MCP handshake", { timeout: 15000 }, async (t) => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "imagerouter-stdio-"));
  const cwd = path.resolve(import.meta.dirname, "..", "..");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["server/mcp/stdio.mjs"],
    cwd,
    env: { ...process.env, IMAGEROUTER_DATA_DIR: dataDirectory },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: "imagerouter-stdio-test", version: "1.0.0" });
  t.after(async () => {
    await client.close().catch(() => {});
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["generate_image", "get_image_router_status", "search_prompt_templates"]);
  const result = await client.callTool({ name: "get_image_router_status", arguments: {} });
  assert.equal(result.structuredContent.name, "ImageRouter");
  assert.match(stderr, /listening on stdio/i);
});
