import { getModelDefinition, getProviderDefinition } from "../providers/catalog.mjs";
import { capabilityError } from "./errors.mjs";

export function assertCapabilities({ provider, model, prompt, referenceImages, aspectRatio }) {
  const providerDefinition = getProviderDefinition(provider);
  if (!providerDefinition) throw capabilityError(`Unknown image provider: ${provider}.`, provider);
  const modelDefinition = getModelDefinition(provider, model);
  if (!modelDefinition) {
    if (referenceImages.length || aspectRatio) {
      throw capabilityError(`Capabilities for ${provider}/${model} are unknown. Remove reference_images and aspect_ratio, or choose a listed model.`, provider);
    }
    return;
  }
  const capabilities = modelDefinition.capabilities;
  if (capabilities.maxPromptLength && prompt.length > capabilities.maxPromptLength) {
    throw capabilityError(`${provider}/${model} accepts prompts up to ${capabilities.maxPromptLength} characters.`, provider);
  }
  if (referenceImages.length && !capabilities.referenceImages) {
    throw capabilityError(`${provider}/${model} does not support reference images.`, provider);
  }
  if (referenceImages.length > (capabilities.maxReferenceImages || 0)) {
    throw capabilityError(`${provider}/${model} accepts at most ${capabilities.maxReferenceImages || 0} reference image(s).`, provider);
  }
  if (provider === "antigravity" && referenceImages.some((item) => /^https:\/\//i.test(item.trim()))) {
    throw capabilityError("Antigravity accepts inline reference images only; pass a data URI or base64 image.", provider);
  }
  if (aspectRatio && !capabilities.aspectRatios.includes(aspectRatio)) {
    throw capabilityError(`${provider}/${model} does not support aspect ratio ${aspectRatio}.`, provider);
  }
}
