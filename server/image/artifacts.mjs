import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ImageRouterError } from "./errors.mjs";

function outputError(message, cause) {
  return new ImageRouterError(message, { code: "OUTPUT_PATH_ERROR", status: 400, cause });
}

export async function preflightArtifactPath(outputPath, { overwrite = false } = {}) {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  const parent = path.dirname(resolved);
  try {
    await fs.mkdir(parent, { recursive: true });
    const parentStat = await fs.stat(parent);
    if (!parentStat.isDirectory()) throw new Error("Parent is not a directory");
    const target = await fs.stat(resolved).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (target?.isDirectory()) throw new Error("Output path points to a directory");
    if (target && !overwrite) throw Object.assign(new Error("File exists"), { code: "EEXIST" });
  } catch (error) {
    if (error?.code === "EEXIST") throw outputError(`Output file already exists: ${resolved}. Set overwrite=true to replace it.`, error);
    throw outputError(`Output path is not writable: ${resolved}. ${error.message}`, error);
  }
  return resolved;
}

export async function writeArtifactAtomic(outputPath, bytes, { overwrite = false } = {}) {
  const resolved = await preflightArtifactPath(outputPath, { overwrite });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;

    if (overwrite) {
      await fs.rename(temporary, resolved);
    } else {
      await fs.link(temporary, resolved);
      await fs.unlink(temporary);
    }
    try { await fs.chmod(resolved, 0o600); } catch {}
    return resolved;
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await fs.unlink(temporary); } catch {}
    if (error?.code === "EEXIST") throw outputError(`Output file already exists: ${resolved}. Set overwrite=true to replace it.`, error);
    throw outputError(`Could not write image to ${resolved}. ${error.message}`, error);
  }
}
