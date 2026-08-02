export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  auth_type TEXT NOT NULL,
  secret_blob TEXT NOT NULL,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_error_code TEXT,
  last_error TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_provider_priority
ON connections(provider, enabled DESC, priority ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS routes (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  output_path TEXT,
  prompt_mode TEXT NOT NULL DEFAULT 'raw',
  template_id TEXT,
  template_pack TEXT,
  enhancer_provider TEXT,
  enhancer_model TEXT,
  enhancer_fallback INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);

CREATE TABLE IF NOT EXISTS enhancer_routes (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
`;

export const DEFAULT_ROUTES = Object.freeze([
  { provider: "xai", model: "grok-imagine-image-quality", position: 0, enabled: true },
  { provider: "antigravity", model: "gemini-3.1-flash-image", position: 1, enabled: true },
  { provider: "codex", model: "gpt-5.5-image", position: 2, enabled: true },
]);

export const DEFAULT_ENHANCER_ROUTES = Object.freeze([
  { provider: "xai", model: "latest", position: 0, enabled: true },
  { provider: "antigravity", model: "gemini-3.1-flash", position: 1, enabled: true },
  { provider: "codex", model: "gpt-5.5", position: 2, enabled: true },
]);
