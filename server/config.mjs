import os from "node:os";
import path from "node:path";

export const APP_NAME = "ImageRouter";
export const APP_VERSION = "1.0.0";
export const DEFAULT_PORT = 20127;
export const DEFAULT_HOST = "127.0.0.1";
export const PROVIDER_IDS = Object.freeze(["xai", "antigravity", "codex"]);

export function getDataDirectory(env = process.env) {
  if (env.IMAGEROUTER_DATA_DIR) return path.resolve(env.IMAGEROUTER_DATA_DIR);
  if (process.platform === "win32" && env.APPDATA) {
    return path.join(env.APPDATA, APP_NAME);
  }
  return path.join(os.homedir(), ".imagerouter");
}

export function getDatabasePath(env = process.env) {
  return path.join(getDataDirectory(env), "imagerouter.sqlite3");
}

export function getConfiguredPort(env = process.env) {
  const value = Number.parseInt(env.IMAGEROUTER_PORT || String(DEFAULT_PORT), 10);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_PORT;
}

export function isProviderId(value) {
  return PROVIDER_IDS.includes(value);
}
