export const PROMPT_MODES = Object.freeze(["raw", "auto", "template"]);
export const PROMPT_PACK_IDS = Object.freeze(["nano-banana-pro", "gpt-image-2"]);
export const PREVIEW_MODES = Object.freeze(["links", "inline", "none"]);
export const MAX_INLINE_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_INLINE_PREVIEW_COUNT = 3;

export const MODEL_AFFINITY = Object.freeze({
  codex: Object.freeze({ "gpt-image-2": 0.18, "nano-banana-pro": 0.02 }),
  antigravity: Object.freeze({ "nano-banana-pro": 0.18, "gpt-image-2": 0.04 }),
  xai: Object.freeze({ "nano-banana-pro": 0.08, "gpt-image-2": 0.08 }),
});

export function modelAffinity(provider, packId) {
  return MODEL_AFFINITY[provider]?.[packId] || 0;
}
