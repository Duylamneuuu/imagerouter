import { ImageRouterDatabase } from "./db/index.mjs";
import { ImageRouter } from "./image/router.mjs";
import { PromptPipeline } from "./image/prompt-pipeline.mjs";
import { ImageRouterService } from "./image/service.mjs";
import { OAuthManager } from "./oauth/manager.mjs";
import { PromptLibrary } from "./prompt/index.mjs";
import { EnhancerRouter } from "./prompt/enhancer.mjs";

const RUNTIME_SYMBOL = Symbol.for("imagerouter.runtime.v1");

export function createRuntime(options = {}) {
  const database = options.database || new ImageRouterDatabase(options.databaseOptions);
  const promptLibrary = options.promptLibrary || new PromptLibrary({ dataDirectory: database.dataDirectory, snapshotDirectory: options.snapshotDirectory });
  const enhancerRouter = options.enhancerRouter || new EnhancerRouter({ database, adapters: options.adapters });
  const promptPipeline = options.promptPipeline || new PromptPipeline({ database, library: promptLibrary, enhancerRouter });
  const router = options.router || new ImageRouter({ database, adapters: options.adapters, promptPipeline });
  const service = options.service || new ImageRouterService({ database, router, promptLibrary, enhancerRouter });
  const oauth = options.oauth || new OAuthManager({ database });
  return { database, router, service, oauth, promptLibrary, enhancerRouter };
}

export function getRuntime() {
  if (!globalThis[RUNTIME_SYMBOL]) globalThis[RUNTIME_SYMBOL] = createRuntime();
  return globalThis[RUNTIME_SYMBOL];
}

export function resetRuntimeForTests() {
  globalThis[RUNTIME_SYMBOL]?.database?.close?.();
  globalThis[RUNTIME_SYMBOL]?.promptLibrary?.close?.();
  delete globalThis[RUNTIME_SYMBOL];
}
