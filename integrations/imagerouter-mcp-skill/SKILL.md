---
name: imagerouter-mcp
description: Use a local ImageRouter MCP server to search prompt templates and generate one image through xAI, Antigravity or Codex.
---

# ImageRouter MCP companion skill

This is an optional companion skill. It is shipped for agents to copy or
install manually; ImageRouter does not install it automatically and this file
contains no prompt data.

## Workflow

1. Use `search_prompt_templates` when the user wants options, style
   references, provenance or a template recommendation. Keep the result's
   attribution and respect `needsReferenceImage`.
2. Use `generate_image` with `prompt_mode: "auto"` when the user wants an
   immediate result. It performs local search, optional English planning,
   enhancement and image generation in one call.
3. Use `prompt_mode: "template"` with a returned `template_id` when the user
   selected a specific template.
4. Use `prompt_mode: "raw"` when the user explicitly asks for byte-for-byte
   prompt preservation.

Leave `provider` as `auto` unless the user requests a provider. Do not expose
   credentials or put prompts into logs, files or activity summaries. Only set
   `output_path` when the user wants a durable local artifact.

## Connection

Configure the local ImageRouter server as an MCP server with either:

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

or the local Streamable HTTP endpoint at `http://127.0.0.1:20127/mcp` with the
bearer token shown in ImageRouter Settings.
