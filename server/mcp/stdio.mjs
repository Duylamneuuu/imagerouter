import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { getRuntime } from "../runtime.mjs";
import { createImageRouterMcpServer } from "./server.mjs";

void serveStdio(() => createImageRouterMcpServer({ service: getRuntime().service }));
console.error("ImageRouter MCP is listening on stdio.");
