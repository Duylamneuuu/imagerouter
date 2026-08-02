import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { normalizePromptPack } from "../server/prompt/records.mjs";

const root = process.cwd();
const snapshotDirectory = path.join(root, "server", "prompt", "packs");
const sourceDirectory = path.join(root, ".prompt-source");
const userAgent = "ImageRouter-prompt-snapshot-builder/1.0";

const PACKS = [
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    model: "nano-banana-pro",
    skillRepo: "YouMind-OpenLab/ai-image-prompts-skill",
    galleryRepo: "YouMind-OpenLab/awesome-nano-banana-pro-prompts",
    galleryUrl: "https://youmind.com/en-US/nano-banana-pro-prompts",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Prompts curated from the open community by YouMind.com.",
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    model: "gpt-image-2",
    skillRepo: "YouMind-OpenLab/gpt-image-2-prompts-search",
    galleryRepo: "YouMind-OpenLab/awesome-gpt-image-2",
    galleryUrl: "https://youmind.com/gpt-image-2-prompts",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Prompts curated from the open community by YouMind.com.",
  },
];

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url) {
  return JSON.parse((await fetchBytes(url)).toString("utf8"));
}

async function currentCommit(repository) {
  const payload = await fetchJson(`https://api.github.com/repos/${repository}/commits/main`);
  if (!payload.sha) throw new Error(`GitHub did not return a commit for ${repository}`);
  return payload.sha;
}

function sourceUrl(pack, id) {
  return `${pack.galleryUrl}?id=${encodeURIComponent(id)}`;
}

function categoryRecord(record, category, pack) {
  const categories = [
    ...(Array.isArray(record.categories) ? record.categories : record.categories ? [record.categories] : []),
    category.slug,
  ].filter(Boolean);
  return {
    ...record,
    categories: [...new Set(categories)],
    sourceLink: record.sourceLink || record.sourceUrl || sourceUrl(pack, record.id),
    model: record.model || pack.model,
    license: record.license || pack.license,
    attribution: record.attribution || pack.attribution,
  };
}

async function buildPack(pack, fetchedAt) {
  const commit = await currentCommit(pack.skillRepo);
  const manifestUrl = `https://raw.githubusercontent.com/${pack.skillRepo}/${commit}/references/manifest.json`;
  const sourceManifest = await fetchJson(manifestUrl);
  const records = [];
  for (const category of sourceManifest.categories || []) {
    if (!category.file || !category.slug) continue;
    const url = `https://raw.githubusercontent.com/${pack.skillRepo}/${commit}/references/${category.file}`;
    const categoryRecords = await fetchJson(url);
    if (!Array.isArray(categoryRecords)) throw new Error(`Expected an array in ${url}`);
    records.push(...categoryRecords.map((record) => categoryRecord(record, category, pack)));
    console.log(`${pack.id}: ${category.file} (${categoryRecords.length.toLocaleString()} records)`);
  }

  const normalized = normalizePromptPack(records, {
    packId: pack.id,
    packMeta: {
      model: pack.model,
      license: pack.license,
      attribution: pack.attribution,
    },
  }).map((record) => ({
    id: record.id,
    sourceId: record.sourceId,
    title: record.title,
    description: record.description,
    content: record.content,
    categories: record.categories,
    sourceMedia: record.sourceMedia,
    needReferenceImages: record.needsReferenceImage,
    model: record.model,
    sourceLink: record.sourceLink,
    sourcePublishedAt: record.sourcePublishedAt,
    author: record.author,
    license: record.license,
    attribution: record.attribution,
  }));
  if (!normalized.length) throw new Error(`${pack.id} produced no valid prompt records`);

  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(normalized)), { level: 9 });
  const file = `${pack.id}.json.gz`;
  await fs.writeFile(path.join(snapshotDirectory, file), compressed);
  return {
    id: pack.id,
    name: pack.name,
    sourceRepo: `https://github.com/${pack.skillRepo}`,
    galleryRepo: `https://github.com/${pack.galleryRepo}`,
    sourceCommit: commit,
    fetchedAt,
    file,
    format: "json.gz",
    count: normalized.length,
    sourceCount: records.length,
    sha256: crypto.createHash("sha256").update(compressed).digest("hex"),
    license: pack.license,
    licenseUrl: pack.licenseUrl,
    attribution: pack.attribution,
    model: pack.model,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  await fs.mkdir(snapshotDirectory, { recursive: true });
  await fs.rm(sourceDirectory, { recursive: true, force: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  try {
    const packs = [];
    for (const pack of PACKS) packs.push(await buildPack(pack, fetchedAt));
    const manifest = {
      schemaVersion: 1,
      release: "ImageRouter Prompt Intelligence v1",
      updatedAt: fetchedAt,
      packs,
    };
    await fs.writeFile(path.join(snapshotDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${packs.reduce((sum, pack) => sum + pack.count, 0).toLocaleString()} normalized prompt records.`);
    for (const pack of packs) console.log(`${pack.id}: ${pack.count.toLocaleString()} records, ${pack.sha256}`);
  } finally {
    await fs.rm(sourceDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
