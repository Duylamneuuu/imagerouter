export const PROVIDER_CATALOG = Object.freeze({
  xai: {
    id: "xai",
    name: "xAI / Grok",
    shortName: "xAI",
    stability: "Stable",
    warning: null,
    authModes: ["api_key", "oauth"],
    defaultModel: "grok-imagine-image-quality",
    defaultTextModel: "latest",
    textModels: [
      { id: "latest", name: "xAI latest language model", experimental: false },
    ],
    models: [
      {
        id: "grok-imagine-image-quality",
        name: "Grok Imagine Image Quality",
        capabilities: {
          textToImage: true,
          maxPromptLength: 1024,
          referenceImages: true,
          maxReferenceImages: 3,
          aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"],
        },
      },
      {
        id: "grok-imagine-image",
        name: "Grok Imagine Image",
        capabilities: {
          textToImage: true,
          maxPromptLength: 1024,
          referenceImages: true,
          maxReferenceImages: 3,
          aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"],
        },
      },
    ],
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    shortName: "AG",
    stability: "Experimental",
    warning: "Private upstream endpoints can change without notice.",
    authModes: ["oauth", "token"],
    defaultModel: "gemini-3.1-flash-image",
    defaultTextModel: "gemini-3.1-flash",
    textModels: [
      { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash", experimental: true },
    ],
    models: [
      {
        id: "gemini-3.1-flash-image",
        name: "Gemini 3.1 Flash Image",
        capabilities: {
          textToImage: true,
          referenceImages: true,
          maxReferenceImages: 1,
          aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
        },
      },
    ],
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    shortName: "Codex",
    stability: "Experimental",
    warning: "Requires an eligible ChatGPT account; the private image endpoint can change without notice.",
    authModes: ["oauth", "token"],
    defaultModel: "gpt-5.5-image",
    defaultTextModel: "gpt-5.5",
    textModels: [
      { id: "gpt-5.5", name: "GPT 5.5", experimental: true },
      { id: "gpt-5.4", name: "GPT 5.4", experimental: true },
      { id: "gpt-5.3", name: "GPT 5.3", experimental: true },
    ],
    models: [
      {
        id: "gpt-5.5-image",
        name: "GPT 5.5 Image",
        capabilities: {
          textToImage: true,
          referenceImages: true,
          maxReferenceImages: 5,
          aspectRatios: ["1:1", "3:2", "2:3"],
        },
      },
      {
        id: "gpt-5.4-image",
        name: "GPT 5.4 Image",
        capabilities: {
          textToImage: true,
          referenceImages: true,
          maxReferenceImages: 5,
          aspectRatios: ["1:1", "3:2", "2:3"],
        },
      },
      {
        id: "gpt-5.3-image",
        name: "GPT 5.3 Image",
        capabilities: {
          textToImage: true,
          referenceImages: true,
          maxReferenceImages: 5,
          aspectRatios: ["1:1", "3:2", "2:3"],
        },
      },
    ],
  },
});

export function getProviderDefinition(provider) {
  return PROVIDER_CATALOG[provider] || null;
}

export function getModelDefinition(provider, model) {
  return getProviderDefinition(provider)?.models.find((item) => item.id === model) || null;
}

export function getPublicCatalog() {
  return Object.values(PROVIDER_CATALOG).map((provider) => ({
    ...provider,
    textModels: provider.textModels.map((model) => ({ ...model })),
    models: provider.models.map((model) => ({
      ...model,
      capabilities: { ...model.capabilities, aspectRatios: [...model.capabilities.aspectRatios] },
    })),
  }));
}
