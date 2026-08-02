import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { ImageRouterError } from "../../server/image/errors.mjs";
import { createImageRouterMcpServer } from "../../server/mcp/server.mjs";

function fakeStatus() {
  return {
    name: "ImageRouter",
    version: "1.0.0",
    mcp: { stdio: true, http: true, path: "/mcp" },
    routes: [],
    providers: [],
    configuredAccounts: 0,
    healthyAccounts: 0,
  };
}

function fixtureService({ promptResults = [] } = {}) {
  return {
    getStatus: fakeStatus,
    getPromptStatus() { return { state: "ready", previewHosts: ["example.com"] }; },
    searchPromptTemplates(input) { return { state: "ready", query: input.query, results: promptResults, confidence: promptResults[0]?.score || 0, searchMode: "local" }; },
    async generate() {
      return {
        bytes: Buffer.from("mcp-image"),
        mimeType: "image/png",
        provider: "xai",
        model: "grok-imagine-image-quality",
        outputPath: null,
        fellBack: false,
        fallbackCount: 0,
        attempts: [{
          provider: "xai",
          model: "grok-imagine-image-quality",
          accountId: "account",
          accountLabel: "primary",
          status: "success",
          code: null,
          durationMs: 12,
          message: null,
        }],
        promptPipeline: { mode: "raw", stages: [], finalPrompt: "fixture" },
      };
    },
  };
}

async function linkedClient(service) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createImageRouterMcpServer({ service });
  await server.connect(serverTransport);
  const client = new Client({ name: "imagerouter-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

test("MCP exposes the image, prompt-search and status tools", async (t) => {
  const { client, server } = await linkedClient(fixtureService());
  t.after(async () => { await client.close(); await server.close(); });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["generate_image", "get_image_router_status", "search_prompt_templates"]);
  const generate = tools.find((tool) => tool.name === "generate_image");
  assert.ok(generate.inputSchema.properties.prompt);
  assert.ok(generate.inputSchema.properties.output_path);
  assert.equal(generate.inputSchema.properties.overwrite.default, false);

  const result = await client.callTool({ name: "generate_image", arguments: { prompt: "fixture" } });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "image");
  assert.equal(Buffer.from(result.content[0].data, "base64").toString(), "mcp-image");
  assert.equal(result.content[1].type, "text");
  assert.equal(result.structuredContent.provider, "xai");
  assert.equal(result.structuredContent.fellBack, false);
  assert.equal(result.structuredContent.promptPipeline.mode, "raw");

  const search = await client.callTool({ name: "search_prompt_templates", arguments: { query: "fixture" } });
  assert.equal(search.structuredContent.results.length, 0);

  const status = await client.callTool({ name: "get_image_router_status", arguments: {} });
  assert.equal(status.structuredContent.name, "ImageRouter");
  assert.doesNotMatch(JSON.stringify(status), /credential|accessToken|apiKey/i);
});

test("MCP cancellation reaches the image service AbortSignal", async (t) => {
  let observedResolve;
  const observed = new Promise((resolve) => { observedResolve = resolve; });
  const service = {
    getStatus: fakeStatus,
    generate(_input, { signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          observedResolve();
          reject(new ImageRouterError("cancelled", { code: "CANCELLED", status: 499 }));
        }, { once: true });
      });
    },
  };
  const { client, server } = await linkedClient(service);
  t.after(async () => { await client.close(); await server.close(); });
  const controller = new AbortController();
  const pending = client.callTool({ name: "generate_image", arguments: { prompt: "fixture" } }, { signal: controller.signal, timeout: 2000 });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending);
  await observed;
});

test("MCP prompt search returns top-three provenance and optional inline preview", async (t) => {
  const promptResults = [1, 2, 3].map((index) => ({
    id: `tpl_${index}`,
    title: `Template ${index}`,
    description: "Fixture template",
    prompt: "A full English fixture prompt",
    categories: ["poster"],
    needsReferenceImage: false,
    sources: [{ packId: "gpt-image-2", license: "CC BY 4.0", attribution: "YouMind" }],
    attribution: "YouMind",
    previewUrls: ["https://example.com/fixture.png"],
    score: 0.9 - index / 100,
  }));
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    return new Response(Buffer.from("preview"), { headers: { "Content-Type": "image/png" } });
  });
  const { client, server } = await linkedClient(fixtureService({ promptResults }));
  t.after(async () => { await client.close(); await server.close(); });
  const linked = await client.callTool({ name: "search_prompt_templates", arguments: { query: "poster", preview_mode: "inline" } });
  assert.equal(linked.structuredContent.results.length, 3);
  assert.equal(linked.structuredContent.results[0].attribution, "YouMind");
  assert.equal(linked.content.filter((block) => block.type === "image").length, 1);
});

test("MCP Streamable HTTP completes handshake and tool listing", async (t) => {
  const handler = createMcpHandler(() => createImageRouterMcpServer({ service: fixtureService() }), { legacy: "stateless", responseMode: "json" });
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:20127/mcp"), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  const client = new Client({ name: "imagerouter-http-test", version: "1.0.0" });
  t.after(async () => { await client.close(); await handler.close(); });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
  const generated = await client.callTool({ name: "generate_image", arguments: { prompt: "http fixture" } });
  assert.equal(generated.content[0].type, "image");
  assert.equal(Buffer.from(generated.content[0].data, "base64").toString(), "mcp-image");
  assert.equal(generated.structuredContent.provider, "xai");
});
