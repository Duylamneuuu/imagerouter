import { antigravityAdapter } from "./antigravity/index.mjs";
import { codexAdapter } from "./codex/index.mjs";
import { xaiAdapter } from "./xai/index.mjs";

export const PROVIDER_ADAPTERS = Object.freeze({
  xai: xaiAdapter,
  antigravity: antigravityAdapter,
  codex: codexAdapter,
});

export function getProviderAdapter(provider) {
  return PROVIDER_ADAPTERS[provider] || null;
}
