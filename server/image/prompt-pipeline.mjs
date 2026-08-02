import { getModelDefinition } from "../providers/catalog.mjs";
import { ImageRouterError } from "./errors.mjs";
import { compileTemplatePrompt, fitEnhancedPrompt } from "../prompt/compiler.mjs";
import { PROMPT_MODES } from "../prompt/constants.mjs";

function setting(database, key, fallback) {
  return database?.getSetting(key, fallback) ?? fallback;
}

function hasNonAscii(value) {
  return /[^\x00-\x7F]/.test(String(value || ""));
}

export class PromptPipeline {
  constructor({ database = null, library = null, enhancerRouter = null } = {}) {
    this.database = database;
    this.library = library;
    this.enhancerRouter = enhancerRouter;
  }

  async run(input, { routes = [], signal } = {}) {
    const configuredMode = setting(this.database, "prompt_mode_default", "raw");
    const mode = input.promptMode || (PROMPT_MODES.includes(configuredMode) && configuredMode !== "template" ? configuredMode : "auto");
    const base = {
      ...input,
      promptOriginal: input.prompt,
      promptMode: mode,
      promptTemplate: null,
      enhancedPrompt: null,
      promptPipeline: { mode, stages: [] },
    };
    if (mode === "raw") {
      return { ...base, promptPipeline: { mode: "raw", stages: [] } };
    }
    if (mode === "template" && !input.templateId) {
      throw new ImageRouterError("template_id is required when prompt_mode=template.", { code: "INVALID_REQUEST", status: 400 });
    }

    const provider = input.provider === "auto" ? routes.find((route) => route.enabled)?.provider || "auto" : input.provider;
    const enhancerEnabled = setting(this.database, "enhancer_enabled", "true") !== "false";
    const timeoutMs = Number.parseInt(setting(this.database, "enhancer_timeout_ms", "30000"), 10);
    let search = this.library?.search({
      query: input.prompt,
      provider,
      source: "all",
      referenceImageCount: input.referenceImages.length,
      limit: 3,
    }) || { state: "unavailable", results: [], confidence: 0, searchMode: "unavailable" };
    const stages = [{ type: "search", mode: search.searchMode, confidence: search.confidence, resultCount: search.results.length }];
    let planner = null;
    if (enhancerEnabled && this.enhancerRouter && (hasNonAscii(input.prompt) || search.confidence < 0.35)) {
      planner = await this.enhancerRouter.planQuery({ userPrompt: input.prompt, signal, timeoutMs });
      stages.push({ type: "query_planner", status: planner.ok ? "success" : "fallback", provider: planner.provider || null, model: planner.model || null });
      if (planner.ok && planner.searchTerms) {
        const replanned = this.library?.search({
          query: planner.searchTerms,
          provider,
          source: "all",
          referenceImageCount: input.referenceImages.length,
          limit: 3,
        });
        if (replanned) search = { ...replanned, searchMode: "llm_assisted" };
      }
    }

    const template = input.templateId ? this.library?.getTemplate(input.templateId) : search.results[0] || null;
    if (mode === "template" && !template) {
      throw new ImageRouterError(`Prompt template ${input.templateId} was not found.`, { code: "INVALID_REQUEST", status: 400 });
    }
    const next = {
      ...base,
      promptTemplate: template,
      promptPipeline: {
        mode,
        stages,
        searchMode: search.searchMode,
        searchConfidence: search.confidence,
        selectedTemplate: template ? { id: template.id, title: template.title, pack: template.sources?.[0]?.packId || null, attribution: template.attribution } : null,
        planner: planner ? { status: planner.ok ? "success" : "fallback", provider: planner.provider || null, model: planner.model || null, attempts: planner.attempts || [] } : null,
        enhancer: null,
        compilerFallback: false,
        warnings: [],
      },
    };

    if (enhancerEnabled && this.enhancerRouter) {
      const enhanced = await this.enhancerRouter.enhance({ userPrompt: input.prompt, template, signal, timeoutMs });
      next.promptPipeline.enhancer = {
        status: enhanced.ok ? "success" : "fallback",
        provider: enhanced.provider || null,
        model: enhanced.model || null,
        attempts: enhanced.attempts || [],
      };
      next.promptPipeline.stages.push({ type: "enhance", status: enhanced.ok ? "success" : "fallback", provider: enhanced.provider || null, model: enhanced.model || null });
      if (enhanced.ok) next.enhancedPrompt = enhanced.prompt;
      else next.promptPipeline.warnings.push("PROMPT_ENHANCEMENT_UNAVAILABLE");
    } else {
      next.promptPipeline.warnings.push("PROMPT_ENHANCER_DISABLED");
    }

    if (!next.enhancedPrompt && template) {
      const compiled = compileTemplatePrompt({ userPrompt: input.prompt, template, maxPromptLength: 100_000 });
      next.prompt = compiled.prompt;
      next.promptPipeline.compilerFallback = true;
      next.promptPipeline.warnings.push("DETERMINISTIC_TEMPLATE_COMPILER");
      next.promptPipeline.warnings.push(...compiled.warnings);
    } else if (next.enhancedPrompt) {
      next.prompt = next.enhancedPrompt;
    } else {
      next.prompt = input.prompt;
      next.promptPipeline.warnings.push("PROMPT_ENHANCEMENT_SKIPPED");
    }
    return next;
  }

  compileForRoute(input, route) {
    const capabilities = getModelDefinition(route.provider, route.model)?.capabilities || {};
    const maxPromptLength = capabilities.maxPromptLength || 100_000;
    let prompt = input.prompt;
    let warnings = [...(input.promptPipeline?.warnings || [])];
    if (input.enhancedPrompt) {
      const fitted = fitEnhancedPrompt({ userPrompt: input.prompt === input.enhancedPrompt ? input.prompt : input.promptOriginal || input.prompt, enhancedPrompt: input.enhancedPrompt, template: input.promptTemplate, maxPromptLength });
      prompt = fitted.prompt;
      warnings.push(...fitted.warnings);
    } else if (input.promptTemplate) {
      const compiled = compileTemplatePrompt({ userPrompt: input.promptOriginal || input.prompt, template: input.promptTemplate, maxPromptLength });
      prompt = compiled.prompt;
      warnings.push(...compiled.warnings);
    }
    return {
      ...input,
      prompt,
      promptPipeline: {
        ...input.promptPipeline,
        provider: route.provider,
        model: route.model,
        finalPrompt: prompt,
        warnings: [...new Set(warnings)],
      },
    };
  }
}
