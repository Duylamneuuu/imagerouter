import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const testDataDirectory = path.resolve(".imagerouter-test", "e2e");

function existingChromiumExecutable() {
  const override = process.env.IMAGEROUTER_PLAYWRIGHT_EXECUTABLE_PATH;
  if (override && fs.existsSync(override)) return path.resolve(override);

  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
    ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)
    : process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ms-playwright")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright");

  if (!fs.existsSync(cacheRoot)) return null;
  const revisions = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((left, right) => Number(right.name.split("-")[1]) - Number(left.name.split("-")[1]));

  const relativeCandidates = process.platform === "win32"
    ? [path.join("chrome-win64", "chrome.exe"), path.join("chrome-win", "chrome.exe")]
    : process.platform === "darwin"
      ? [path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"), path.join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium")]
      : [path.join("chrome-linux", "chrome")];

  for (const revision of revisions) {
    const directory = path.join(cacheRoot, revision.name);
    if (!fs.existsSync(path.join(directory, "INSTALLATION_COMPLETE"))) continue;
    for (const relative of relativeCandidates) {
      const candidate = path.join(directory, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const executablePath = existingChromiumExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:20127",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: "node tests/e2e/start-server.mjs",
    url: "http://127.0.0.1:20127",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      IMAGEROUTER_DATA_DIR: testDataDirectory,
      IMAGEROUTER_PORT: "20127",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
