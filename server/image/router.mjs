import { getModelDefinition, getProviderDefinition } from "../providers/catalog.mjs";
import { getProviderAdapter } from "../providers/index.mjs";
import { tokenExpired } from "../providers/shared.mjs";
import { redactText } from "../security/redaction.mjs";
import { assertCapabilities } from "./capabilities.mjs";
import { preflightArtifactPath, writeArtifactAtomic } from "./artifacts.mjs";
import { ImageRouterError, isImageRouterError, normalizeThrownError } from "./errors.mjs";
import { PromptPipeline } from "./prompt-pipeline.mjs";
import { normalizeGenerateInput, parseProviderModel } from "./validation.mjs";

function publicAttempt({ provider, model, account, status, code = null, durationMs = 0, message = null }) {
  return {
    provider,
    model,
    accountId: account?.id || null,
    accountLabel: account?.label || null,
    status,
    code,
    durationMs: Math.max(0, Math.round(durationMs)),
    message: message == null ? null : redactText(message),
  };
}

function finalError(error, attempts) {
  const normalized = normalizeThrownError(error);
  normalized.attempts = attempts;
  normalized.fallbackCount = attempts.filter((attempt) => attempt.status !== "success").length;
  return normalized;
}

export class ImageRouter {
  constructor({ database, adapters = null, promptPipeline = null }) {
    this.database = database;
    this.adapters = adapters;
    this.promptPipeline = promptPipeline || new PromptPipeline({ database });
  }

  getAdapter(provider) {
    return this.adapters?.[provider] || getProviderAdapter(provider);
  }

  #routesFor(input) {
    const prefixed = parseProviderModel(input.model);
    if (prefixed && input.provider !== "auto" && input.provider !== prefixed.provider) {
      throw new ImageRouterError(`provider=${input.provider} conflicts with model=${input.model}.`, { code: "INVALID_REQUEST", status: 400 });
    }
    const requestedProvider = prefixed?.provider || (input.provider !== "auto" ? input.provider : null);
    const requestedModel = prefixed?.model || (prefixed ? null : input.model);
    const storedRoutes = this.database.getRoutes();
    const explicit = Boolean(requestedProvider);

    if (explicit) {
      const stored = storedRoutes.find((route) => route.provider === requestedProvider);
      const definition = getProviderDefinition(requestedProvider);
      return {
        explicit: true,
        routes: [{
          provider: requestedProvider,
          model: requestedModel || stored?.model || definition?.defaultModel,
          enabled: true,
        }],
      };
    }

    let routes = storedRoutes.filter((route) => route.enabled);
    if (requestedModel) {
      routes = routes.map((route) => ({
        ...route,
        model: getModelDefinition(route.provider, requestedModel) ? requestedModel : route.model,
      }));
    }
    if (this.database.getSetting("fallback_enabled", "true") === "false") routes = routes.slice(0, 1);
    return { explicit: false, routes };
  }

  async #refreshConnection(adapter, account, signal, timeoutMs) {
    try {
      const credentials = await adapter.refresh(account.credentials, { signal, timeoutMs });
      return this.database.updateConnectionCredentials(account.id, credentials);
    } catch (error) {
      throw new ImageRouterError("The provider token could not be refreshed.", {
        code: "TOKEN_REFRESH_FAILED",
        status: 401,
        retryable: true,
        provider: account.provider,
        cause: error,
      });
    }
  }

  async #executeAccount({ adapter, account, route, input, signal, timeoutMs }) {
    let active = account;
    let refreshed = false;
    if (tokenExpired(active) && active.credentials.refreshToken) {
      active = await this.#refreshConnection(adapter, active, signal, timeoutMs);
      refreshed = true;
    }

    const invoke = async () => {
      if (typeof adapter.prepare === "function") {
        const prepared = await adapter.prepare({ credentials: active.credentials, signal, timeoutMs });
        if (prepared?.credentialPatch) active = this.database.updateConnectionCredentials(active.id, prepared.credentialPatch);
      }
      return adapter.generate({
        model: route.model,
        prompt: input.prompt,
        referenceImages: input.referenceImages,
        aspectRatio: input.aspectRatio,
        credentials: active.credentials,
        signal,
        timeoutMs,
      });
    };

    try {
      return await invoke();
    } catch (error) {
      const normalized = normalizeThrownError(error, route.provider, { cancelled: signal?.aborted });
      if (normalized.code === "AUTH_FAILED" && active.credentials.refreshToken && !refreshed) {
        active = await this.#refreshConnection(adapter, active, signal, timeoutMs);
        return invoke();
      }
      throw normalized;
    }
  }

  async generate(rawInput, { signal } = {}) {
    const startedAt = Date.now();
    const normalizedInput = normalizeGenerateInput(rawInput);
    if (normalizedInput.outputPath) await preflightArtifactPath(normalizedInput.outputPath, { overwrite: normalizedInput.overwrite });
    const { explicit, routes } = this.#routesFor(normalizedInput);
    const attempts = [];
    const timeoutMs = Number.parseInt(this.database.getSetting("request_timeout_ms", "120000"), 10);
    let lastError = null;

    if (!routes.length) {
      throw finalError(new ImageRouterError("No enabled image routes are configured.", { code: "NO_ROUTE", status: 503 }), attempts);
    }

    const input = await this.promptPipeline.run(normalizedInput, { routes, explicit, signal });

    for (const route of routes) {
      if (signal?.aborted) throw finalError(new ImageRouterError("Image generation was cancelled.", { code: "CANCELLED", status: 499 }), attempts);
      const routedInput = this.promptPipeline.compileForRoute(input, route);
      try {
        assertCapabilities({ ...route, prompt: routedInput.prompt, referenceImages: routedInput.referenceImages, aspectRatio: routedInput.aspectRatio });
      } catch (error) {
        attempts.push(publicAttempt({ provider: route.provider, model: route.model, status: "skipped", code: error.code, message: error.message }));
        lastError = error;
        if (explicit) throw finalError(error, attempts);
        continue;
      }

      const adapter = this.getAdapter(route.provider);
      const accounts = this.database.listConnections({ provider: route.provider, enabledOnly: true, includeCredentials: true });
      if (!adapter || accounts.length === 0) {
        const error = new ImageRouterError(`No enabled ${getProviderDefinition(route.provider)?.name || route.provider} account is configured.`, {
          code: "NO_CONNECTION",
          status: 503,
          provider: route.provider,
        });
        attempts.push(publicAttempt({ provider: route.provider, model: route.model, status: "skipped", code: error.code, message: error.message }));
        lastError = error;
        if (explicit) throw finalError(error, attempts);
        continue;
      }

      for (const account of accounts) {
        const attemptStartedAt = Date.now();
        try {
          const image = await this.#executeAccount({ adapter, account, route, input: routedInput, signal, timeoutMs });
          this.database.updateConnectionHealth(account.id, { status: "healthy" });
          attempts.push(publicAttempt({ provider: route.provider, model: image.model || route.model, account, status: "success", durationMs: Date.now() - attemptStartedAt }));
          const outputPath = input.outputPath
            ? await writeArtifactAtomic(input.outputPath, image.bytes, { overwrite: input.overwrite })
            : null;
          const fallbackCount = attempts.filter((attempt) => attempt.status !== "success").length;
          const result = {
            bytes: image.bytes,
            mimeType: image.mimeType,
            provider: route.provider,
            model: image.model || route.model,
            outputPath,
            fellBack: fallbackCount > 0,
            fallbackCount,
            attempts,
            durationMs: Date.now() - startedAt,
            promptPipeline: routedInput.promptPipeline,
          };
          this.database.recordActivity({
            provider: result.provider,
            model: result.model,
            durationMs: result.durationMs,
            status: "success",
            fallbackCount,
            outputPath,
            promptMode: routedInput.promptMode,
            templateId: routedInput.promptTemplate?.id || null,
            templatePack: routedInput.promptTemplate?.sources?.[0]?.packId || null,
            enhancerProvider: routedInput.promptPipeline?.enhancer?.provider || null,
            enhancerModel: routedInput.promptPipeline?.enhancer?.model || null,
            enhancerFallback: routedInput.promptPipeline?.enhancer?.status === "fallback" || routedInput.promptPipeline?.planner?.status === "fallback" || routedInput.promptPipeline?.compilerFallback,
          });
          return result;
        } catch (caught) {
          if (isImageRouterError(caught) && caught.code === "OUTPUT_PATH_ERROR") {
            const failed = finalError(caught, attempts);
            this.database.recordActivity({
              provider: route.provider,
              model: route.model,
              durationMs: Date.now() - startedAt,
              status: "error",
              fallbackCount: failed.fallbackCount,
              errorCode: caught.code,
              outputPath: input.outputPath,
              promptMode: input.promptMode,
              templateId: input.promptTemplate?.id || null,
              templatePack: input.promptTemplate?.sources?.[0]?.packId || null,
            });
            throw failed;
          }
          const error = normalizeThrownError(caught, route.provider, { cancelled: signal?.aborted });
          lastError = error;
          this.database.updateConnectionHealth(account.id, {
            status: error.retryable ? "degraded" : "error",
            errorCode: error.code,
            error: error.message,
          });
          attempts.push(publicAttempt({
            provider: route.provider,
            model: route.model,
            account,
            status: "failed",
            code: error.code,
            durationMs: Date.now() - attemptStartedAt,
            message: error.message,
          }));
          if (!error.retryable || error.code === "CANCELLED") {
            const failed = finalError(error, attempts);
            this.database.recordActivity({
              provider: route.provider,
              model: route.model,
              durationMs: Date.now() - startedAt,
              status: "error",
              fallbackCount: failed.fallbackCount,
              errorCode: error.code,
              outputPath: input.outputPath,
              promptMode: input.promptMode,
              templateId: input.promptTemplate?.id || null,
              templatePack: input.promptTemplate?.sources?.[0]?.packId || null,
              enhancerProvider: input.promptPipeline?.enhancer?.provider || null,
              enhancerModel: input.promptPipeline?.enhancer?.model || null,
              enhancerFallback: input.promptPipeline?.enhancer?.status === "fallback" || input.promptPipeline?.planner?.status === "fallback" || input.promptPipeline?.compilerFallback,
            });
            throw failed;
          }
        }
      }

      if (explicit && lastError) break;
    }

    const exhausted = finalError(lastError || new ImageRouterError("No image route completed the request.", { code: "ALL_ROUTES_FAILED", status: 503 }), attempts);
    this.database.recordActivity({
      provider: lastError?.provider,
      model: null,
      durationMs: Date.now() - startedAt,
      status: "error",
      fallbackCount: exhausted.fallbackCount,
      errorCode: exhausted.code,
      outputPath: input.outputPath,
      promptMode: input.promptMode,
      templateId: input.promptTemplate?.id || null,
      templatePack: input.promptTemplate?.sources?.[0]?.packId || null,
      enhancerProvider: input.promptPipeline?.enhancer?.provider || null,
      enhancerModel: input.promptPipeline?.enhancer?.model || null,
      enhancerFallback: input.promptPipeline?.enhancer?.status === "fallback" || input.promptPipeline?.planner?.status === "fallback" || input.promptPipeline?.compilerFallback,
    });
    throw exhausted;
  }

  async testConnection(id, { signal } = {}) {
    let account = this.database.getConnection(id, { includeCredentials: true });
    if (!account) throw new ImageRouterError("Connection not found.", { code: "NOT_FOUND", status: 404 });
    const adapter = this.getAdapter(account.provider);
    if (!adapter) throw new ImageRouterError("Provider adapter not found.", { code: "CONFIGURATION_ERROR", status: 500 });
    try {
      if (tokenExpired(account) && account.credentials.refreshToken) {
        account = await this.#refreshConnection(adapter, account, signal, 30000);
      }
      const result = await adapter.health({ credentials: account.credentials, signal, timeoutMs: 15000 });
      if (result.credentialPatch) this.database.updateConnectionCredentials(id, result.credentialPatch);
      this.database.updateConnectionHealth(id, { status: "healthy" });
      return { ok: true, models: result.models || [] };
    } catch (caught) {
      const error = normalizeThrownError(caught, account.provider, { cancelled: signal?.aborted });
      this.database.updateConnectionHealth(id, { status: "error", errorCode: error.code, error: error.message });
      throw error;
    }
  }
}
