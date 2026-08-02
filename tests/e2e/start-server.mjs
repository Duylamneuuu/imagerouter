import fs from "node:fs/promises";
import path from "node:path";

const target = path.resolve(".imagerouter-test", "e2e");
const allowedRoot = path.resolve(".imagerouter-test");

if (!target.startsWith(`${allowedRoot}${path.sep}`)) {
  throw new Error("Refusing to clear an unexpected E2E data directory");
}

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });

if (!process.argv.includes("--dev")) process.argv.push("--dev");
await import("../../server/http/start.mjs");
