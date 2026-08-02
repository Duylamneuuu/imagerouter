import { getPublicCatalog } from "../providers/catalog.mjs";

export class ImageRouterService {
  constructor({ database, router, promptLibrary = null, enhancerRouter = null }) {
    this.database = database;
    this.router = router;
    this.promptLibrary = promptLibrary;
    this.enhancerRouter = enhancerRouter;
  }

  generate(input, options) {
    return this.router.generate(input, options);
  }

  testConnection(id, options) {
    return this.router.testConnection(id, options);
  }

  searchPromptTemplates(input) {
    return this.promptLibrary?.search(input) || { state: "unavailable", results: [], confidence: 0, searchMode: "unavailable" };
  }

  getPromptTemplate(id) {
    return this.promptLibrary?.getTemplate(id) || null;
  }

  getPromptStatus() {
    return this.promptLibrary?.getStatus() || { state: "unavailable", reason: "NOT_CONFIGURED", packs: [], totalTemplates: 0, updatedAt: null };
  }

  getEnhancerRoutes() {
    return this.database.getEnhancerRoutes();
  }

  updateEnhancerRoutes(routes) {
    return this.database.updateEnhancerRoutes(routes);
  }

  getStatus() {
    const routes = this.database.getRoutes();
    const connections = this.database.listConnections();
    const enabledConnections = connections.filter((connection) => connection.enabled);
    const configuredPort = Number.parseInt(this.database.getSetting("http_port", "20127"), 10);
    const activePortValue = Number.parseInt(process.env.IMAGEROUTER_ACTIVE_PORT || "", 10);
    const httpPort = Number.isInteger(activePortValue) && activePortValue > 0 && activePortValue <= 65535
      ? activePortValue
      : configuredPort;
    const providers = getPublicCatalog().map((provider) => {
      const accounts = connections.filter((connection) => connection.provider === provider.id);
      const enabledAccounts = accounts.filter((account) => account.enabled);
      return {
        ...provider,
        accounts,
        health: enabledAccounts.some((account) => account.status === "healthy")
          ? "healthy"
          : enabledAccounts.some((account) => account.status === "degraded")
            ? "degraded"
            : enabledAccounts.some((account) => account.status === "error")
              ? "error"
              : enabledAccounts.length
                ? "unknown"
                : accounts.length
                  ? "disabled"
                  : "unconfigured",
      };
    });
    return {
      name: "ImageRouter",
      version: "1.0.0",
      mcp: {
        stdio: true,
        http: true,
        host: "127.0.0.1",
        port: httpPort,
        configuredPort,
        restartRequired: httpPort !== configuredPort,
        path: "/mcp",
        url: `http://127.0.0.1:${httpPort}/mcp`,
      },
      routes,
      enhancerRoutes: this.database.getEnhancerRoutes(),
      prompts: this.getPromptStatus(),
      promptSettings: {
        mode: this.database.getSetting("prompt_mode_default", "auto"),
        enhancerEnabled: this.database.getSetting("enhancer_enabled", "true") !== "false",
      },
      providers,
      configuredAccounts: connections.length,
      enabledAccounts: enabledConnections.length,
      healthyAccounts: enabledConnections.filter((connection) => connection.status === "healthy").length,
    };
  }
}
