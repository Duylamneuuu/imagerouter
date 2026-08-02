import path from "node:path";

import { ImageRouterError } from "./errors.mjs";
import { PROMPT_MODES } from "../prompt/constants.mjs";

const PROVIDERS = new Set(["auto", "xai", "antigravity", "codex"]);
const ASPECT_RATIO_PATTERN = /^(?:auto|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/;
export const MAX_REFERENCE_IMAGE_CHARACTERS = Math.ceil((32 * 1024 * 1024) / 3) * 4 + 256;

function invalid(message) {
  throw new ImageRouterError(message, { code: "INVALID_REQUEST", status: 400 });
}

export function normalizeGenerateInput(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("Image request must be an object.");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0) invalid("prompt is required.");
  if (raw.prompt.length > 100_000) invalid("prompt exceeds the 100,000 character limit.");
  const provider = raw.provider == null ? "auto" : String(raw.provider).toLowerCase();
  if (!PROVIDERS.has(provider)) invalid("provider must be auto, xai, antigravity or codex.");

  const model = raw.model == null || raw.model === "" ? null : String(raw.model);
  const referenceImages = raw.referenceImages ?? raw.reference_images ?? [];
  if (!Array.isArray(referenceImages)) invalid("reference_images must be an array.");
  if (referenceImages.length > 8) invalid("reference_images accepts at most 8 images.");
  if (referenceImages.some((item) => typeof item !== "string" || !item.trim())) invalid("Each reference image must be a non-empty string.");
  if (referenceImages.some((item) => item.length > MAX_REFERENCE_IMAGE_CHARACTERS)) invalid("Each inline reference image must be 32 MB or smaller.");

  const aspectRatio = raw.aspectRatio ?? raw.aspect_ratio ?? null;
  if (aspectRatio != null && !ASPECT_RATIO_PATTERN.test(String(aspectRatio))) {
    invalid("aspect_ratio must look like 1:1, 16:9 or auto.");
  }

  const outputValue = raw.outputPath ?? raw.output_path ?? null;
  if (outputValue != null && (typeof outputValue !== "string" || !outputValue.trim())) invalid("output_path must be a non-empty path.");

  const promptModeValue = raw.promptMode ?? raw.prompt_mode ?? null;
  if (promptModeValue != null && !PROMPT_MODES.includes(String(promptModeValue).toLowerCase())) {
    invalid("prompt_mode must be raw, auto or template.");
  }
  const templateIdValue = raw.templateId ?? raw.template_id ?? null;
  if (templateIdValue != null && (typeof templateIdValue !== "string" || !templateIdValue.trim())) invalid("template_id must be a non-empty string.");

  return {
    prompt: raw.prompt,
    promptMode: promptModeValue == null ? null : String(promptModeValue).toLowerCase(),
    templateId: templateIdValue == null ? null : String(templateIdValue),
    provider,
    model,
    referenceImages: [...referenceImages],
    aspectRatio: aspectRatio == null ? null : String(aspectRatio),
    outputPath: outputValue == null ? null : path.resolve(outputValue),
    overwrite: raw.overwrite === true,
  };
}

export function parseProviderModel(model) {
  if (!model || !model.includes("/")) return null;
  const slash = model.indexOf("/");
  const provider = model.slice(0, slash).toLowerCase();
  const providerModel = model.slice(slash + 1);
  if (!providerModel) invalid("model must use provider/model when a provider prefix is present.");
  if (!PROVIDERS.has(provider) || provider === "auto") invalid("model contains an unsupported provider prefix.");
  return { provider, model: providerModel };
}
