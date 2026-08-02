import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ImageRouterDatabase } from "../../server/db/index.mjs";

test("custom data directory owns both SQLite and the credential key", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imagerouter-data-dir-"));
  const database = new ImageRouterDatabase({ dataDirectory: directory });
  t.after(async () => {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  assert.equal(database.filePath, path.join(directory, "imagerouter.sqlite3"));
  assert.equal((await fs.stat(path.join(directory, "imagerouter.sqlite3"))).isFile(), true);
  assert.equal((await fs.stat(path.join(directory, "credential.key"))).isFile(), true);
});
