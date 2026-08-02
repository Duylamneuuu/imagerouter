import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import Database from "better-sqlite3";

import { modelAffinity, PROMPT_PACK_IDS } from "./constants.mjs";
import { normalizePromptPack } from "./records.mjs";

const INDEX_SCHEMA = `
PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;
CREATE TABLE templates (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  needs_reference_image INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  preview_url TEXT,
  source_link TEXT,
  author_name TEXT,
  author_link TEXT,
  license TEXT NOT NULL,
  attribution TEXT NOT NULL
);
CREATE TABLE sources (
  template_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_published_at TEXT,
  source_link TEXT,
  preview_url TEXT,
  model TEXT,
  author_name TEXT,
  author_link TEXT,
  license TEXT NOT NULL,
  attribution TEXT NOT NULL,
  PRIMARY KEY(template_id, pack_id, source_id),
  FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
);
CREATE TABLE categories (
  template_id TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY(template_id, category),
  FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE templates_fts USING fts5(
  title,
  description,
  content,
  categories,
  content='templates',
  content_rowid='rowid'
);
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX idx_sources_pack ON sources(pack_id);
CREATE INDEX idx_categories_category ON categories(category);
`;

function nowIso() { return new Date().toISOString(); }

function readPackFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const bytes = filePath.endsWith(".gz") ? zlib.gunzipSync(raw) : raw;
  const text = bytes.toString("utf8");
  if (filePath.endsWith(".jsonl") || filePath.endsWith(".jsonl.gz")) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  return parsed.prompts || parsed.records || parsed.data || [];
}

function packManifest(snapshotDirectory) {
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.packs)) throw new Error("Prompt pack manifest must contain packs[].");
  return manifest;
}

function safeSnapshotPath(snapshotDirectory, fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) return null;
  const root = path.resolve(snapshotDirectory);
  const resolved = path.resolve(root, fileName);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function manifestSignature(manifest) {
  return JSON.stringify({
    schemaVersion: manifest?.schemaVersion || 1,
    packs: (manifest?.packs || []).map((pack) => ({ id: pack.id, sha256: pack.sha256, count: pack.count })),
  });
}

function safePackId(packId) {
  return PROMPT_PACK_IDS.includes(packId) ? packId : null;
}

function groupedCategories(item) {
  return [...item.categories].join(" ");
}

function mergeRecords(records) {
  const templates = new Map();
  for (const item of records) {
    const existing = templates.get(item.id);
    if (!existing) {
      templates.set(item.id, {
        ...item,
        categories: new Set(item.categories),
        sources: new Map([[`${item.packId}:${item.sourceId}`, item]]),
      });
      continue;
    }
    for (const category of item.categories) existing.categories.add(category);
    existing.sourceMedia = [...new Set([...existing.sourceMedia, ...item.sourceMedia])];
    existing.sources.set(`${item.packId}:${item.sourceId}`, item);
    if (!existing.description && item.description) existing.description = item.description;
  }
  return [...templates.values()];
}

export class PromptLibrary {
  constructor({ dataDirectory, snapshotDirectory = path.join(process.cwd(), "server", "prompt", "packs") } = {}) {
    this.dataDirectory = dataDirectory || path.join(process.cwd(), ".imagerouter-data");
    this.snapshotDirectory = snapshotDirectory;
    this.filePath = path.join(this.dataDirectory, "prompts.sqlite");
    this.db = null;
    this.status = { state: "unavailable", reason: "NO_BUNDLED_PACKS", packs: [], totalTemplates: 0, updatedAt: null, previewHosts: [] };
    this.initialize();
  }

  initialize() {
    try {
      const manifest = packManifest(this.snapshotDirectory);
      if (!manifest) return;
      const metadata = { ...manifest, packs: manifest.packs.map((pack) => ({ ...pack, id: safePackId(pack.id) || pack.id })) };
      if (this.#reuseExisting(metadata)) return;
      const records = [];
      const invalidPacks = [];
      for (const pack of metadata.packs) {
        const packId = safePackId(pack.id);
        const filePath = safeSnapshotPath(this.snapshotDirectory, pack.file);
        try {
          if (!packId || !filePath || !fs.existsSync(filePath)) throw new Error("snapshot file is missing or outside the pack directory");
          if (!/^[a-f0-9]{64}$/i.test(String(pack.sha256 || ""))) throw new Error("sha256 is required in the snapshot manifest");
          if (sha256File(filePath).toLowerCase() !== String(pack.sha256).toLowerCase()) throw new Error("snapshot checksum does not match the manifest");
          const rawRecords = readPackFile(filePath);
          if (pack.count != null && Number(pack.count) !== rawRecords.length) throw new Error("snapshot count does not match the manifest");
          records.push(...normalizePromptPack(rawRecords, { packId, packMeta: pack }));
        } catch (error) {
          invalidPacks.push({ id: pack.id, reason: error.message });
        }
      }
      if (!records.length) {
        this.status = {
          state: "unavailable",
          reason: invalidPacks.length ? "SNAPSHOT_INVALID" : "NO_VALID_PROMPTS",
          packs: metadata.packs,
          invalidPacks,
          totalTemplates: 0,
          updatedAt: metadata.updatedAt || null,
          previewHosts: [],
        };
        return;
      }
      this.rebuildFromRecords(records, { ...metadata, invalidPacks });
      if (invalidPacks.length) {
        this.status = { ...this.status, state: "degraded", reason: "SNAPSHOT_PARTIAL", invalidPacks };
      }
    } catch (error) {
      this.status = {
        state: "unavailable",
        reason: "SNAPSHOT_INVALID",
        packs: [],
        invalidPacks: [{ reason: error.message }],
        totalTemplates: 0,
        updatedAt: null,
        previewHosts: [],
      };
    }
  }

  #reuseExisting(metadata) {
    const db = this.#openExisting();
    if (!db) return false;
    try {
      const manifestValue = db.prepare("SELECT value FROM metadata WHERE key = 'manifest'").get()?.value;
      const stored = JSON.parse(manifestValue || "null");
      if (!stored || manifestSignature(stored) !== manifestSignature(metadata)) {
        db.close();
        this.db = null;
        return false;
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM templates").get().count;
      const previews = db.prepare("SELECT preview_url AS url FROM templates WHERE preview_url IS NOT NULL UNION SELECT preview_url AS url FROM sources WHERE preview_url IS NOT NULL").all();
      const invalidPacks = metadata.invalidPacks || stored.invalidPacks || [];
      this.status = {
        state: invalidPacks.length ? "degraded" : "ready",
        reason: invalidPacks.length ? "SNAPSHOT_PARTIAL" : null,
        packs: metadata.packs || stored.packs || [],
        invalidPacks,
        totalTemplates: count,
        updatedAt: metadata.updatedAt || stored.updatedAt || null,
        previewHosts: [...new Set(previews.map((item) => { try { return new URL(item.url).hostname; } catch { return null; } }).filter(Boolean))],
      };
      return true;
    } catch {
      try { db.close(); } catch {}
      this.db = null;
      return false;
    }
  }

  rebuildFromRecords(records, metadata = {}) {
    fs.mkdirSync(this.dataDirectory, { recursive: true, mode: 0o700 });
    const normalized = mergeRecords(records);
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    let db = null;
    try {
      db = new Database(tempPath);
      db.exec(INDEX_SCHEMA);
      const insertTemplate = db.prepare(`INSERT INTO templates(id, content_hash, title, description, content, needs_reference_image, model, preview_url, source_link, author_name, author_link, license, attribution) VALUES(@id, @contentHash, @title, @description, @content, @needsReferenceImage, @model, @previewUrl, @sourceLink, @authorName, @authorLink, @license, @attribution)`);
      const insertSource = db.prepare(`INSERT INTO sources(template_id, pack_id, source_id, source_published_at, source_link, preview_url, model, author_name, author_link, license, attribution) VALUES(@templateId, @packId, @sourceId, @sourcePublishedAt, @sourceLink, @previewUrl, @model, @authorName, @authorLink, @license, @attribution)`);
      const insertCategory = db.prepare("INSERT INTO categories(template_id, category) VALUES(?, ?)");
      const insertFts = db.prepare("INSERT INTO templates_fts(rowid, title, description, content, categories) VALUES(?, ?, ?, ?, ?)");
      const insertMeta = db.prepare("INSERT INTO metadata(key, value) VALUES(?, ?)");
      db.transaction(() => {
        for (const item of normalized) {
          const row = {
            id: item.id,
            contentHash: item.contentHash,
            title: item.title,
            description: item.description,
            content: item.content,
            needsReferenceImage: item.needsReferenceImage ? 1 : 0,
            model: item.model,
            previewUrl: item.sourceMedia[0] || null,
            sourceLink: item.sourceLink,
            authorName: item.author.name,
            authorLink: item.author.link,
            license: item.license,
            attribution: item.attribution,
          };
          insertTemplate.run(row);
          const rowid = db.prepare("SELECT rowid FROM templates WHERE id = ?").get(item.id).rowid;
          insertFts.run(rowid, item.title, item.description, item.content, groupedCategories(item));
          for (const category of item.categories) insertCategory.run(item.id, category);
          for (const source of item.sources.values()) insertSource.run({
            templateId: item.id,
            packId: source.packId,
            sourceId: source.sourceId,
            sourcePublishedAt: source.sourcePublishedAt,
            sourceLink: source.sourceLink,
            previewUrl: source.sourceMedia[0] || null,
            model: source.model,
            authorName: source.author.name,
            authorLink: source.author.link,
            license: source.license,
            attribution: source.attribution,
          });
        }
        insertMeta.run("updated_at", metadata.updatedAt || nowIso());
        insertMeta.run("manifest", JSON.stringify(metadata));
        insertMeta.run("sha256", crypto.createHash("sha256").update(JSON.stringify(normalized.map((item) => [item.id, item.contentHash]))).digest("hex"));
      })();
      db.close();
      db = null;
      if (this.db) this.db.close();
      const backupPath = `${this.filePath}.previous`;
      const hadExisting = fs.existsSync(this.filePath);
      try {
        if (hadExisting) fs.renameSync(this.filePath, backupPath);
        fs.renameSync(tempPath, this.filePath);
      } catch (error) {
        if (hadExisting && !fs.existsSync(this.filePath) && fs.existsSync(backupPath)) {
          try { fs.renameSync(backupPath, this.filePath); } catch {}
        }
        throw error;
      }
      try { if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true }); } catch {}
      this.db = new Database(this.filePath, { readonly: true });
      this.status = {
        state: "ready",
        reason: null,
        packs: metadata.packs || [],
        invalidPacks: metadata.invalidPacks || [],
        totalTemplates: normalized.length,
        updatedAt: metadata.updatedAt || nowIso(),
        previewHosts: [...new Set(normalized.flatMap((item) => item.sourceMedia.map((url) => { try { return new URL(url).hostname; } catch { return null; } }).filter(Boolean)))],
      };
    } catch (error) {
      try { db?.close(); } catch {}
      try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
  }

  #openExisting() {
    if (this.db) return this.db;
    if (!fs.existsSync(this.filePath)) return null;
    try {
      this.db = new Database(this.filePath, { readonly: true });
      if (this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("Prompt index integrity check failed.");
    } catch {
      try { this.db?.close(); } catch {}
      this.db = null;
      this.status = { ...this.status, state: "unavailable", reason: "INDEX_CORRUPT" };
    }
    return this.db;
  }

  getStatus() {
    if (this.status.state !== "ready" && this.status.state !== "degraded" && this.#openExisting()) {
      try {
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM templates").get().count;
        const manifest = this.db.prepare("SELECT value FROM metadata WHERE key = 'manifest'").get()?.value;
        const parsed = JSON.parse(manifest || "{}");
        const previews = this.db.prepare("SELECT preview_url AS url FROM templates WHERE preview_url IS NOT NULL UNION SELECT preview_url AS url FROM sources WHERE preview_url IS NOT NULL").all();
        this.status = { state: "ready", reason: null, packs: parsed.packs || [], invalidPacks: parsed.invalidPacks || [], totalTemplates: count, updatedAt: parsed.updatedAt || null, previewHosts: [...new Set(previews.map((item) => { try { return new URL(item.url).hostname; } catch { return null; } }).filter(Boolean))] };
      } catch {
        this.status = { ...this.status, state: "unavailable", reason: "INDEX_CORRUPT" };
      }
    }
    return JSON.parse(JSON.stringify(this.status));
  }

  #searchTokens(query) {
    return String(query || "").toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [];
  }

  search({ query, provider = "auto", source = "all", referenceImageCount = 0, limit = 3 } = {}) {
    const db = this.#openExisting();
    if (!db) return { state: this.status.state, query: String(query || ""), results: [], confidence: 0, searchMode: "unavailable" };
    try {
      const tokens = this.#searchTokens(query).filter((token) => token.length > 1).slice(0, 12);
      if (!tokens.length) return { state: "ready", query: String(query || ""), results: [], confidence: 0, searchMode: "local" };
      const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
      const referenceFlag = Number(referenceImageCount) > 0 ? 1 : 0;
      const candidateRows = db.prepare(`
      SELECT rowid, bm25(templates_fts, 6.0, 3.0, 1.0, 2.0) AS rank
      FROM templates_fts
      WHERE templates_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      `).all(match, Math.min(50, Math.max(1, Number(limit) * 5 || 15)));
      const templateQuery = db.prepare(`
      SELECT templates.*, GROUP_CONCAT(DISTINCT categories.category) AS category_text
      FROM templates
      LEFT JOIN categories ON categories.template_id = templates.id
      WHERE templates.rowid = ?
        AND (? > 0 OR templates.needs_reference_image = 0)
        AND (? = 'all' OR EXISTS (
          SELECT 1 FROM sources source_filter
          WHERE source_filter.template_id = templates.id AND source_filter.pack_id = ?
        ))
      GROUP BY templates.id
      `);
      const rows = [];
      for (const candidate of candidateRows) {
        const row = templateQuery.get(candidate.rowid, referenceFlag, source || "all", source || "all");
        if (row) rows.push({ ...row, rank: candidate.rank });
      }
      const results = rows.map((row, index) => this.#publicTemplate(row, provider, index, rows.length));
      const top = results[0]?.score || 0;
      return { state: "ready", query: String(query || ""), results: results.slice(0, Math.min(10, Math.max(1, Number(limit) || 3))), confidence: top, searchMode: "local" };
    } catch {
      this.status = { ...this.status, state: "unavailable", reason: "INDEX_CORRUPT" };
      try { this.db?.close(); } catch {}
      this.db = null;
      return { state: "unavailable", query: String(query || ""), results: [], confidence: 0, searchMode: "unavailable" };
    }
  }

  #publicTemplate(row, provider, index, resultCount) {
    const sources = this.db.prepare("SELECT * FROM sources WHERE template_id = ? ORDER BY pack_id, source_id").all(row.id).map((source) => ({
      packId: source.pack_id,
      sourceId: source.source_id,
      sourcePublishedAt: source.source_published_at,
      sourceLink: source.source_link,
      previewUrl: source.preview_url,
      model: source.model,
      author: { name: source.author_name, link: source.author_link },
      license: source.license,
      attribution: source.attribution,
    }));
    const packs = [...new Set(sources.map((source) => source.packId))];
    const affinity = packs.reduce((sum, packId) => sum + modelAffinity(provider, packId), 0);
    const previewUrls = [...new Set([row.preview_url, ...sources.map((source) => source.previewUrl)].filter(Boolean))];
    const baseScore = 1 - (index / Math.max(1, resultCount));
    const score = Math.max(0, Math.min(1, baseScore * 0.82 + affinity));
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      prompt: row.content,
      categories: row.category_text ? row.category_text.split(",").filter(Boolean) : [],
      needsReferenceImage: Boolean(row.needs_reference_image),
      model: row.model,
      previewUrls,
      sourceLink: row.source_link,
      author: { name: row.author_name, link: row.author_link },
      license: row.license,
      attribution: row.attribution,
      sources,
      score: Number(score.toFixed(4)),
      modelAffinity: Number(affinity.toFixed(4)),
    };
  }

  getTemplate(id) {
    const db = this.#openExisting();
    if (!db || !id) return null;
    try {
      const row = db.prepare("SELECT templates.*, GROUP_CONCAT(DISTINCT categories.category) AS category_text FROM templates LEFT JOIN categories ON categories.template_id = templates.id WHERE templates.id = ? GROUP BY templates.id").get(id);
      return row ? this.#publicTemplate(row, "auto", 0, 1) : null;
    } catch {
      this.status = { ...this.status, state: "unavailable", reason: "INDEX_CORRUPT" };
      try { this.db?.close(); } catch {}
      this.db = null;
      return null;
    }
  }

  close() { this.db?.close(); this.db = null; }
}
