# ImageRouter

ImageRouter is a local MCP control plane for image generation. It gives coding
agents one stable interface for xAI/Grok, Antigravity and OpenAI Codex, with
ordered account/provider fallback and optional local prompt intelligence.

## What it does

- MCP over stdio and Streamable HTTP at `/mcp`.
- OpenAI-compatible `POST /v1/images/generations`.
- Three image connectors only: xAI/Grok (Stable), Antigravity (Experimental),
  and OpenAI Codex (Experimental).
- Multiple accounts per connector, account-priority retries and an ordered
  image route chain.
- `search_prompt_templates` plus `generate_image` prompt modes: `raw`,
  `auto`, and `template`.
- Separate enhancer route chain for English planning/remixing. Enhancer errors
  fall back to deterministic local compilation and never block image generation.
- No gallery, prompt history, image cache, chat, audio, video, search engine,
  CLI provider manager or analytics.

The prompt feature is offline-first. This checkout includes two release-pinned,
compressed text/metadata snapshots from the YouMind Nano Banana Pro and GPT
Image 2 collections. ImageRouter never downloads or updates prompt packs at
runtime. If a release is built without its snapshots, raw generation and
LLM-only enhancement still work and the Prompts screen reports pack setup.

## Requirements

- Node.js 20 or newer.
- A supported provider account.
- An MCP client for agent integration.

## Install and run

```bash
git clone https://github.com/Duylamneuuu/imagerouter.git
cd imagerouter
npm install
npm run dev
```

Open `http://127.0.0.1:20127`. Add accounts on **Providers**, test them, order
the image and prompt-enhancer routes on **Routing**, and reveal the local HTTP
token in **Settings** when an HTTP client needs it.

Production:

```bash
npm run build
npm run start
```

All servers bind to `127.0.0.1`. Port, data directory and provider environment
variables are documented in [`.env.example`](.env.example).

## MCP

### stdio

```bash
npm run mcp:stdio
```

Example client configuration:

```json
{
  "mcpServers": {
    "imagerouter": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "C:/absolute/path/to/ImageRouter"
    }
  }
}
```

The launcher keeps stdout reserved for MCP protocol frames and writes
diagnostics to stderr.

### Streamable HTTP

Start the dashboard, then connect to:

```text
http://127.0.0.1:20127/mcp
```

Send `Authorization: Bearer <token>` using the token shown in Settings.

### Prompt workflow

Use `search_prompt_templates` when an agent or user wants the top three local
options, full prompt text, source attribution and preview links. Use
`generate_image` with `prompt_mode: "auto"` for one-call search, optional
English planning/remix and generation. Use `prompt_mode: "template"` with a
returned `template_id` for an explicit selection, or `raw` to bypass the
prompt pipeline.

Example:

```json
{
  "prompt": "A clean product launch poster for a local developer tool",
  "provider": "auto",
  "prompt_mode": "auto",
  "reference_images": [],
  "overwrite": false
}
```

Every successful MCP response includes an image content block, a short text
summary, and structured provenance: actual provider/model, final prompt,
selected template/attribution, search confidence, enhancer attempts, fallback
status and warnings. The final prompt is never written to SQLite or activity
logs.

An optional agent-facing companion skill is included at
[`integrations/imagerouter-mcp-skill/SKILL.md`](integrations/imagerouter-mcp-skill/SKILL.md).
It is not installed automatically and contains no prompt data.

## REST compatibility

```bash
curl http://127.0.0.1:20127/v1/images/generations \
  -H "Authorization: Bearer $IMAGEROUTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "prompt": "A cobalt technical illustration on cool paper",
    "prompt_mode": "auto",
    "response_format": "b64_json"
  }'
```

`model` accepts `auto` or `provider/model`. JSON responses retain the OpenAI
image shape and add a `router` object with route and prompt-pipeline metadata.
Use `response_format: "binary"` or `Accept: image/*` for image bytes. Binary
responses expose only compact provenance headers; the final prompt is not put
in a header.

## Routing semantics

- The first enabled image route is the default.
- `provider: "auto"` tries accounts in priority order, then continues to the
  next route.
- An explicit provider tries its other accounts but never crosses to another
  provider.
- Cross-provider fallback is limited to timeout, network, quota/rate-limit,
  token-refresh, capacity and upstream 5xx failures.
- Invalid parameters, safety rejection, output-path errors and capability
  mismatches stop the request. In auto mode an incompatible route is skipped.
- Prompt enhancement has its own ordered three-provider chain. Failed text
  calls degrade to local template compilation or raw prompt without failing the
  image request.

## Prompt snapshots

The supported release packs are:

- [`awesome-nano-banana-pro-prompts`](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts), CC BY 4.0.
- [`awesome-gpt-image-2`](https://github.com/YouMind-OpenLab/awesome-gpt-image-2), CC BY 4.0.

The related [`awesome-grok-imagine-prompts`](https://github.com/YouMind-OpenLab/awesome-grok-imagine-prompts)
repository is intentionally excluded because it is a video-prompt collection.
Snapshot format, manifest requirements, SHA-256 validation and release pinning
are documented in [`server/prompt/packs/README.md`](server/prompt/packs/README.md).

Snapshots are compressed text/metadata only. Preview images are fetched only
on demand from validated HTTPS hosts, are limited to 5 MiB per MCP search, and
are never cached.

Maintainers can refresh the pinned release snapshots deliberately with
`npm run prompts:release`. This is a release-build operation, not a runtime
update mechanism.

## Local data and privacy

Default data locations:

- Windows: `%APPDATA%/ImageRouter`
- macOS/Linux: `~/.imagerouter`

Set `IMAGEROUTER_DATA_DIR` to use another location. ImageRouter never reads or
modifies data outside that configured directory.

SQLite stores encrypted provider credentials, route/settings metadata and
activity metadata (timestamp, provider/model, duration, status, fallback count,
error code, template/pack IDs and output path). It does not store user prompts,
final prompts, image blobs, base64 or preview images. The Playground uses a
temporary object URL and revokes it when replaced or unmounted.

The HTTP server validates the loopback Host/Origin and bearer token. Prompt
template text is treated as untrusted data; enhancer instructions explicitly
separate user intent from template guidance and prohibit tool, credential and
network requests.

## Development and tests

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Or run the local non-browser check:

```bash
npm run check
```

E2E uses an already installed Chromium/Chrome executable when available. The
test command does not install a browser. Real-provider smoke tests are opt-in:

```bash
npm run test:smoke
```

## Architecture

```text
server/providers/   xAI, Antigravity and Codex image/text adapters
server/image/       validation, prompt pipeline, routing and artifacts
server/prompt/      snapshots, FTS5 search, compiler, enhancer and previews
server/mcp/         shared MCP factory plus stdio launcher
server/rest/        OpenAI-compatible image endpoint
server/db/          SQLite schema and encrypted credential vault
src/app/            local workbench: Overview, Providers, Routing, Prompts,
                    Playground, Activity and Settings
tests/              unit, integration, responsive E2E and opt-in smoke tests
```

## Attribution and license

ImageRouter is an independent rewrite. Portions of the Antigravity and Codex
adapter behavior were adapted from the MIT-licensed
[`decolua/9router`](https://github.com/decolua/9router) project. Prompt-pack
provenance and YouMind notices are in [`NOTICE.md`](NOTICE.md).

ImageRouter is MIT licensed. See [`LICENSE`](LICENSE).
