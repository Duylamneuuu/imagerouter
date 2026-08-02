import { createMcpHandler } from "@modelcontextprotocol/server";

import { getRuntime } from "../runtime.mjs";
import { redactText } from "../security/redaction.mjs";
import { createImageRouterMcpServer } from "./server.mjs";

const HANDLER_SYMBOL = Symbol.for("imagerouter.mcp.http.v1");

export function getMcpHttpHandler() {
  if (!globalThis[HANDLER_SYMBOL]) {
    globalThis[HANDLER_SYMBOL] = createMcpHandler(
      () => createImageRouterMcpServer({ service: getRuntime().service }),
      { responseMode: "auto", legacy: "stateless", onerror: (error) => console.error("[ImageRouter MCP]", redactText(error.message)) },
    );
  }
  return globalThis[HANDLER_SYMBOL];
}
