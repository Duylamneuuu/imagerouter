import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ImageRouterDatabase } from "../server/db/index.mjs";

export async function createTestDatabase(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imagerouter-test-"));
  const database = new ImageRouterDatabase({
    filePath: ":memory:",
    dataDirectory: directory,
    vaultKey: Buffer.alloc(32, 7),
  });
  t.after(async () => {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { database, directory };
}

export function successImage(model = "fixture-model") {
  return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mimeType: "image/png", model };
}
