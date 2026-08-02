import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { DEFAULT_PORT, PROVIDER_IDS, getDataDirectory, isProviderId } from "../config.mjs";
import { redactText, collectSecrets } from "../security/redaction.mjs";
import { CredentialVault } from "../security/vault.mjs";
import { DEFAULT_ENHANCER_ROUTES, DEFAULT_ROUTES, SCHEMA_SQL } from "./schema.mjs";

function nowIso() {
  return new Date().toISOString();
}

function bool(value) {
  return value ? 1 : 0;
}

function publicConnection(row) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    authType: row.auth_type,
    status: row.status,
    lastErrorCode: row.last_error_code || null,
    lastError: row.last_error || null,
    lastCheckedAt: row.last_checked_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ImageRouterDatabase {
  constructor({ filePath, dataDirectory, vaultKey } = {}) {
    this.dataDirectory = dataDirectory || getDataDirectory();
    this.filePath = filePath || path.join(this.dataDirectory, "imagerouter.sqlite3");
    if (this.filePath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      try { fs.chmodSync(path.dirname(this.filePath), 0o700); } catch {}
    }
    this.vault = new CredentialVault({ dataDirectory: this.dataDirectory, key: vaultKey });
    this.db = new Database(this.filePath);
    this.db.pragma("foreign_keys = ON");
    if (this.filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
    this.#migrate();
    this.#seed();
    if (this.filePath !== ":memory:") {
      try { fs.chmodSync(this.filePath, 0o600); } catch {}
    }
  }

  #migrate() {
    const columns = new Set(this.db.prepare("PRAGMA table_info(activity)").all().map((row) => row.name));
    const additions = [
      ["prompt_mode", "TEXT NOT NULL DEFAULT 'raw'"],
      ["template_id", "TEXT"],
      ["template_pack", "TEXT"],
      ["enhancer_provider", "TEXT"],
      ["enhancer_model", "TEXT"],
      ["enhancer_fallback", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE activity ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enhancer_routes (
        provider TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        position INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
    const version = Number(this.db.pragma("user_version", { simple: true }) || 0);
    if (version < 2) this.db.pragma("user_version = 2");
  }

  #seed() {
    const timestamp = nowIso();
    const insertRoute = this.db.prepare(`
      INSERT OR IGNORE INTO routes(provider, model, position, enabled, updated_at)
      VALUES(@provider, @model, @position, @enabled, @updated_at)
    `);
    const seedRoutes = this.db.transaction(() => {
      for (const route of DEFAULT_ROUTES) {
        insertRoute.run({ ...route, enabled: bool(route.enabled), updated_at: timestamp });
      }
    });
    seedRoutes();

    const insertEnhancerRoute = this.db.prepare(`
      INSERT OR IGNORE INTO enhancer_routes(provider, model, position, enabled, updated_at)
      VALUES(@provider, @model, @position, @enabled, @updated_at)
    `);
    this.db.transaction(() => {
      for (const route of DEFAULT_ENHANCER_ROUTES) insertEnhancerRoute.run({ ...route, enabled: bool(route.enabled), updated_at: timestamp });
    })();

    const defaults = {
      http_token: crypto.randomBytes(32).toString("base64url"),
      http_port: String(DEFAULT_PORT),
      fallback_enabled: "true",
      request_timeout_ms: "120000",
      prompt_mode_default: "auto",
      enhancer_enabled: "true",
      enhancer_timeout_ms: "30000",
    };
    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES(?, ?, ?)
    `);
    for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value, timestamp);
  }

  close() {
    if (this.db.open) this.db.close();
  }

  getSetting(key, fallback = null) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
  }

  getSettings({ revealToken = false } = {}) {
    const rows = this.db.prepare("SELECT key, value FROM settings").all();
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      httpPort: Number.parseInt(values.http_port || String(DEFAULT_PORT), 10),
      fallbackEnabled: values.fallback_enabled !== "false",
      requestTimeoutMs: Number.parseInt(values.request_timeout_ms || "120000", 10),
      promptModeDefault: values.prompt_mode_default || "auto",
      enhancerEnabled: values.enhancer_enabled !== "false",
      enhancerTimeoutMs: Number.parseInt(values.enhancer_timeout_ms || "30000", 10),
      httpToken: revealToken ? values.http_token : "••••••••••••••••••••••••",
      dataPath: this.dataDirectory,
      databasePath: this.filePath,
    };
  }

  updateSettings(patch) {
    const allowed = new Map([
      ["httpPort", "http_port"],
      ["fallbackEnabled", "fallback_enabled"],
      ["requestTimeoutMs", "request_timeout_ms"],
      ["promptModeDefault", "prompt_mode_default"],
      ["enhancerEnabled", "enhancer_enabled"],
      ["enhancerTimeoutMs", "enhancer_timeout_ms"],
    ]);
    const statement = this.db.prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const update = this.db.transaction(() => {
      for (const [publicKey, dbKey] of allowed) {
        if (!(publicKey in patch)) continue;
        statement.run(dbKey, String(patch[publicKey]), nowIso());
      }
    });
    update();
    return this.getSettings();
  }

  rotateHttpToken() {
    const token = crypto.randomBytes(32).toString("base64url");
    this.db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'http_token'").run(token, nowIso());
    return token;
  }

  getHttpToken() {
    return this.getSetting("http_token");
  }

  addConnection({ provider, label, authType, credentials, enabled = true }) {
    if (!isProviderId(provider)) throw new Error(`Unsupported provider: ${provider}`);
    if (!label?.trim()) throw new Error("Connection label is required");
    const id = crypto.randomUUID();
    const priority = this.db.prepare("SELECT COALESCE(MAX(priority), -1) + 1 AS value FROM connections WHERE provider = ?").get(provider).value;
    const timestamp = nowIso();
    const expiresAt = credentials?.expiresAt || (credentials?.expiresIn ? Date.now() + Number(credentials.expiresIn) * 1000 : null);
    this.db.prepare(`
      INSERT INTO connections(
        id, provider, label, priority, enabled, auth_type, secret_blob, expires_at,
        status, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
    `).run(
      id,
      provider,
      label.trim(),
      priority,
      bool(enabled),
      authType,
      this.vault.encrypt(credentials),
      expiresAt,
      timestamp,
      timestamp,
    );
    return this.getConnection(id);
  }

  getConnection(id, { includeCredentials = false } = {}) {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
    if (!row) return null;
    const result = publicConnection(row);
    if (includeCredentials) result.credentials = this.vault.decrypt(row.secret_blob);
    return result;
  }

  listConnections({ provider, enabledOnly = false, includeCredentials = false } = {}) {
    const clauses = [];
    const params = [];
    if (provider) { clauses.push("provider = ?"); params.push(provider); }
    if (enabledOnly) clauses.push("enabled = 1");
    const sql = `SELECT * FROM connections${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY provider, priority, created_at`;
    return this.db.prepare(sql).all(...params).map((row) => {
      const result = publicConnection(row);
      if (includeCredentials) result.credentials = this.vault.decrypt(row.secret_blob);
      return result;
    });
  }

  updateConnection(id, patch) {
    const current = this.getConnection(id, { includeCredentials: true });
    if (!current) throw new Error("Connection not found");
    const label = patch.label === undefined ? current.label : String(patch.label).trim();
    if (!label) throw new Error("Connection label is required");
    const enabled = patch.enabled === undefined ? current.enabled : Boolean(patch.enabled);
    const credentials = patch.credentials ? { ...current.credentials, ...patch.credentials } : current.credentials;
    const expiresAt = credentials?.expiresAt || (credentials?.expiresIn ? Date.now() + Number(credentials.expiresIn) * 1000 : current.expiresAt);
    this.db.prepare(`
      UPDATE connections SET label = ?, enabled = ?, secret_blob = ?, expires_at = ?, updated_at = ? WHERE id = ?
    `).run(label, bool(enabled), this.vault.encrypt(credentials), expiresAt, nowIso(), id);
    return this.getConnection(id);
  }

  updateConnectionCredentials(id, credentials) {
    const current = this.getConnection(id, { includeCredentials: true });
    if (!current) throw new Error("Connection not found");
    const merged = { ...current.credentials, ...credentials };
    const expiresAt = merged.expiresAt || (merged.expiresIn ? Date.now() + Number(merged.expiresIn) * 1000 : current.expiresAt);
    this.db.prepare("UPDATE connections SET secret_blob = ?, expires_at = ?, updated_at = ? WHERE id = ?")
      .run(this.vault.encrypt(merged), expiresAt, nowIso(), id);
    return this.getConnection(id, { includeCredentials: true });
  }

  updateConnectionHealth(id, { status, errorCode = null, error = null }) {
    const current = this.getConnection(id, { includeCredentials: true });
    const safeError = error ? redactText(error, collectSecrets(current?.credentials)) : null;
    this.db.prepare(`
      UPDATE connections SET status = ?, last_error_code = ?, last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?
    `).run(status, errorCode, safeError, nowIso(), nowIso(), id);
    return this.getConnection(id);
  }

  reorderConnections(provider, orderedIds) {
    if (!PROVIDER_IDS.includes(provider)) throw new Error("Unsupported provider");
    const existing = this.listConnections({ provider }).map((item) => item.id);
    if (existing.length !== orderedIds.length || existing.some((id) => !orderedIds.includes(id))) {
      throw new Error("Connection order must contain every account exactly once");
    }
    const update = this.db.prepare("UPDATE connections SET priority = ?, updated_at = ? WHERE id = ? AND provider = ?");
    this.db.transaction(() => orderedIds.forEach((id, index) => update.run(index, nowIso(), id, provider)))();
    return this.listConnections({ provider });
  }

  removeConnection(id) {
    return this.db.prepare("DELETE FROM connections WHERE id = ?").run(id).changes > 0;
  }

  getRoutes() {
    const rows = this.db.prepare("SELECT provider, model, position, enabled, updated_at FROM routes ORDER BY position").all();
    const defaultIndex = rows.findIndex((row) => Boolean(row.enabled));
    return rows
      .map((row, index) => ({
        provider: row.provider,
        model: row.model,
        position: row.position,
        enabled: Boolean(row.enabled),
        isDefault: index === defaultIndex,
        updatedAt: row.updated_at,
      }));
  }

  updateRoutes(routes) {
    if (!Array.isArray(routes) || routes.length !== PROVIDER_IDS.length) {
      throw new Error("Route chain must contain exactly three providers");
    }
    const ids = routes.map((route) => route.provider);
    if (new Set(ids).size !== PROVIDER_IDS.length || PROVIDER_IDS.some((id) => !ids.includes(id))) {
      throw new Error("Route chain must contain xAI, Antigravity and Codex exactly once");
    }
    const statement = this.db.prepare(`
      UPDATE routes SET model = ?, position = ?, enabled = ?, updated_at = ? WHERE provider = ?
    `);
    this.db.transaction(() => routes.forEach((route, index) => {
      statement.run(String(route.model), index, bool(route.enabled !== false), nowIso(), route.provider);
    }))();
    return this.getRoutes();
  }

  getEnhancerRoutes() {
    const rows = this.db.prepare("SELECT provider, model, position, enabled, updated_at FROM enhancer_routes ORDER BY position").all();
    const defaultIndex = rows.findIndex((row) => Boolean(row.enabled));
    return rows.map((row, index) => ({
      provider: row.provider,
      model: row.model,
      position: row.position,
      enabled: Boolean(row.enabled),
      isDefault: index === defaultIndex,
      updatedAt: row.updated_at,
    }));
  }

  updateEnhancerRoutes(routes) {
    if (!Array.isArray(routes) || routes.length !== PROVIDER_IDS.length) throw new Error("Enhancer route chain must contain exactly three providers");
    const ids = routes.map((route) => route.provider);
    if (new Set(ids).size !== PROVIDER_IDS.length || PROVIDER_IDS.some((id) => !ids.includes(id))) {
      throw new Error("Enhancer route chain must contain xAI, Antigravity and Codex exactly once");
    }
    const statement = this.db.prepare("UPDATE enhancer_routes SET model = ?, position = ?, enabled = ?, updated_at = ? WHERE provider = ?");
    this.db.transaction(() => routes.forEach((route, index) => statement.run(String(route.model), index, bool(route.enabled !== false), nowIso(), route.provider)))();
    return this.getEnhancerRoutes();
  }

  recordActivity({ provider = null, model = null, durationMs, status, fallbackCount = 0, errorCode = null, outputPath = null, promptMode = "raw", templateId = null, templatePack = null, enhancerProvider = null, enhancerModel = null, enhancerFallback = false }) {
    const row = {
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      provider,
      model,
      durationMs: Math.max(0, Math.round(durationMs || 0)),
      status,
      fallbackCount: Math.max(0, Number(fallbackCount || 0)),
      errorCode,
      outputPath,
      promptMode,
      templateId,
      templatePack,
      enhancerProvider,
      enhancerModel,
      enhancerFallback: bool(enhancerFallback),
    };
    this.db.prepare(`
      INSERT INTO activity(id, timestamp, provider, model, duration_ms, status, fallback_count, error_code, output_path, prompt_mode, template_id, template_pack, enhancer_provider, enhancer_model, enhancer_fallback)
      VALUES(@id, @timestamp, @provider, @model, @durationMs, @status, @fallbackCount, @errorCode, @outputPath, @promptMode, @templateId, @templatePack, @enhancerProvider, @enhancerModel, @enhancerFallback)
    `).run(row);
    return row;
  }

  listActivity(limit = 100) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.db.prepare(`
      SELECT id, timestamp, provider, model, duration_ms, status, fallback_count, error_code, output_path, prompt_mode, template_id, template_pack, enhancer_provider, enhancer_model, enhancer_fallback
      FROM activity ORDER BY timestamp DESC LIMIT ?
    `).all(safeLimit).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      durationMs: row.duration_ms,
      status: row.status,
      fallbackCount: row.fallback_count,
      errorCode: row.error_code,
      outputPath: row.output_path,
      promptMode: row.prompt_mode,
      templateId: row.template_id,
      templatePack: row.template_pack,
      enhancerProvider: row.enhancer_provider,
      enhancerModel: row.enhancer_model,
      enhancerFallback: Boolean(row.enhancer_fallback),
    }));
  }
}
