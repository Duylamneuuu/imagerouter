import http from "node:http";

import next from "next";

import { DEFAULT_HOST, DEFAULT_PORT, getConfiguredPort } from "../config.mjs";
import { getRuntime } from "../runtime.mjs";

const development = process.argv.includes("--dev");
const runtime = getRuntime();
const savedPort = Number.parseInt(runtime.database.getSetting("http_port", String(DEFAULT_PORT)), 10);
const envPortIsSet = typeof process.env.IMAGEROUTER_PORT === "string" && process.env.IMAGEROUTER_PORT.trim() !== "";
const port = envPortIsSet
  ? getConfiguredPort(process.env)
  : Number.isInteger(savedPort) && savedPort > 0 && savedPort <= 65535
    ? savedPort
    : DEFAULT_PORT;

if (envPortIsSet && savedPort !== port) runtime.database.updateSettings({ httpPort: port });
process.env.IMAGEROUTER_ACTIVE_PORT = String(port);

const app = next({
  dev: development,
  dir: process.cwd(),
  hostname: DEFAULT_HOST,
  port,
});

await app.prepare();

const server = http.createServer((request, response) => app.getRequestHandler()(request, response));
server.on("upgrade", app.getUpgradeHandler());

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, DEFAULT_HOST, resolve);
});

console.log(`ImageRouter ${development ? "development" : "production"} server: http://${DEFAULT_HOST}:${port}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  runtime.database.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void close().finally(() => process.exit(0));
  });
}
