import crypto from "node:crypto";

function stringValue(value, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function contentValue(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch {}
  }
  return "";
}

function listValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function categoryValues(record) {
  const values = [
    ...listValue(record.categories),
    ...listValue(record.category),
    ...listValue(record.useCase),
  ];
  if (record.imageCategories && typeof record.imageCategories === "object") {
    for (const [group, value] of Object.entries(record.imageCategories)) {
      for (const item of listValue(value)) values.push(`${group}:${item}`);
    }
  }
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function sourceMedia(record) {
  const values = [
    ...listValue(record.sourceMedia),
    ...listValue(record.previewUrls),
  ];
  if (Array.isArray(record.media)) {
    values.push(...record.media.flatMap((item) => typeof item === "string" ? [item] : listValue(item?.url)));
  }
  return [...new Set(values.map((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(url.hostname)) return null;
      return url.toString();
    } catch { return null; }
  }).filter(Boolean))];
}

function sourceAuthor(record) {
  if (typeof record.author === "string") return { name: record.author, link: null };
  return {
    name: stringValue(record.author?.name || record.authorName, "Community contributor"),
    link: stringValue(record.author?.link || record.authorUrl, "") || null,
  };
}

function normalizeForHash(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizePromptRecord(record, { packId, packMeta = {} } = {}) {
  if (!validatePromptRecord(record).valid) return null;
  const content = contentValue(record.content || record.prompt || record.text);
  if (!content) return null;
  const sourceId = stringValue(record.sourceId || record.id || record.slug);
  if (!sourceId) return null;
  const title = stringValue(record.title || record.name, `Prompt ${sourceId}`);
  const description = stringValue(record.description || record.summary);
  const contentHash = crypto.createHash("sha256").update(normalizeForHash(content)).digest("hex");
  const sourceLink = stringValue(record.sourceLink || record.sourceUrl || record.url, "") || null;
  const author = sourceAuthor(record);
  return {
    id: `tpl_${contentHash.slice(0, 24)}`,
    contentHash,
    sourceId,
    packId,
    title,
    description,
    content,
    categories: categoryValues(record),
    sourceMedia: sourceMedia(record),
    needsReferenceImage: Boolean(record.needReferenceImages ?? record.needsReferenceImage ?? record.requiresReferenceImage),
    model: stringValue(record.model, packMeta.model || packId),
    sourceLink,
    sourcePublishedAt: stringValue(record.sourcePublishedAt || record.publishedAt, "") || null,
    author,
    license: stringValue(record.license, packMeta.license || "CC BY 4.0"),
    attribution: stringValue(record.attribution, packMeta.attribution || "Prompts curated from the open community by YouMind.com."),
  };
}

export function validatePromptRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return { valid: false, errors: ["record must be an object"] };
  if (!contentValue(record.content || record.prompt || record.text)) errors.push("content is required");
  if (!stringValue(record.id || record.slug || record.sourceId)) errors.push("id is required");
  return { valid: errors.length === 0, errors };
}

export function validatePromptPack(records) {
  const errors = [];
  for (const [index, record] of (records || []).entries()) {
    const result = validatePromptRecord(record);
    if (!result.valid) errors.push({ index, errors: result.errors });
  }
  return { valid: errors.length === 0, errors, count: Array.isArray(records) ? records.length : 0 };
}

export function normalizePromptPack(records, metadata = {}) {
  const normalized = [];
  for (const record of records || []) {
    const item = normalizePromptRecord(record, metadata);
    if (item) normalized.push(item);
  }
  return normalized;
}
