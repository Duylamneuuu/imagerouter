import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { preflightArtifactPath, writeArtifactAtomic } from "../../server/image/artifacts.mjs";

test("atomic artifact writer creates exactly one requested file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imagerouter-artifact-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "nested", "output.png");
  const bytes = Buffer.from("fixture-image");
  const written = await writeArtifactAtomic(target, bytes);
  assert.equal(written, path.resolve(target));
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.deepEqual(await fs.readdir(path.dirname(target)), ["output.png"]);
});

test("artifact writer protects existing files unless overwrite is true", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imagerouter-overwrite-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "output.png");
  await fs.writeFile(target, "original");
  await assert.rejects(preflightArtifactPath(target), (error) => error.code === "OUTPUT_PATH_ERROR");
  await assert.rejects(writeArtifactAtomic(target, Buffer.from("new")), (error) => error.code === "OUTPUT_PATH_ERROR");
  assert.equal(await fs.readFile(target, "utf8"), "original");
  await writeArtifactAtomic(target, Buffer.from("replacement"), { overwrite: true });
  assert.equal(await fs.readFile(target, "utf8"), "replacement");
});
