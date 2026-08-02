# ImageRouter prompt snapshots

This directory is intentionally text/metadata only. A release may place two
compressed snapshots here:

- `nano-banana-pro.json.gz` from `YouMind-OpenLab/awesome-nano-banana-pro-prompts`
- `gpt-image-2.json.gz` from `YouMind-OpenLab/awesome-gpt-image-2`

The release manifest is `manifest.json`. Each pack entry must include:

```json
{
  "id": "nano-banana-pro",
  "name": "Nano Banana Pro",
  "sourceRepo": "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
  "sourceCommit": "<pinned commit>",
  "fetchedAt": "<UTC timestamp>",
  "file": "nano-banana-pro.json.gz",
  "format": "json",
  "count": 0,
  "sha256": "<sha256 of the compressed file>",
  "license": "CC BY 4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
  "attribution": "Prompts curated from the open community by YouMind.com.",
  "model": "nano-banana-pro"
}
```

The compressed payload is an array of records with `id`, `content`, title and
description fields plus optional categories, reference-image requirements,
source links, preview URLs and author metadata. ImageRouter validates the
manifest and SHA-256 before building a temporary FTS5 database and swapping it
into `%APPDATA%/ImageRouter/prompts.sqlite` (or `~/.imagerouter` on Unix).

Snapshots are pinned per ImageRouter release. The application never downloads,
updates or caches prompt packs at runtime, and it never stores preview images.
