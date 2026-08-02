"use client";

import { ArrowRight, CheckCircle2, Circle, Radio } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

function httpSnippet(url) {
  return JSON.stringify({
    mcpServers: {
      imagerouter: {
        url,
        headers: { Authorization: "Bearer ${IMAGEROUTER_TOKEN}" },
      },
    },
  }, null, 2);
}

const STDIO_SNIPPET = `{
  "mcpServers": {
    "imagerouter": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "/absolute/path/to/ImageRouter"
    }
  }
}`;

export function Overview() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/status").then(setStatus).catch(setError);
  }, []);

  const enabledRoutes = useMemo(() => status?.routes?.filter((route) => route.enabled) || [], [status]);
  const ready = Boolean(status?.enabledAccounts);
  const mcpUrl = status?.mcp?.url || "http://127.0.0.1:20127/mcp";
  const httpConfig = httpSnippet(mcpUrl);

  return (
    <>
      <PageHeader
        title="ImageRouter is listening locally."
        description="One image-generation control plane for MCP clients, with an explicit default route and bounded fallback."
        actions={<StatusPill tone={ready ? "healthy" : "warning"}>{ready ? "Ready" : "Setup required"}</StatusPill>}
      />

      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {!status && !error ? <LoadingBlock /> : null}

      {status ? (
        <>
          <div className="runtime-line" aria-label="Runtime summary">
            <div className="runtime-line__item"><span className="runtime-line__label">MCP HTTP</span><span className="runtime-line__value">{mcpUrl.replace("http://", "")}</span></div>
            <div className="runtime-line__item"><span className="runtime-line__label">Accounts</span><span className="runtime-line__value">{status.enabledAccounts} enabled · {status.healthyAccounts} healthy</span></div>
            <div className="runtime-line__item"><span className="runtime-line__label">Default route</span><span className="runtime-line__value">{enabledRoutes[0] ? `${enabledRoutes[0].provider}/${enabledRoutes[0].model}` : "none"}</span></div>
          </div>

          <section className="workspace-section">
            <div className="section-head">
              <h2>Route chain</h2>
              <p>The first enabled entry is the default. Auto mode exhausts its account pool before moving down this list.</p>
            </div>
            <ol className="plain-list">
              {status.routes.map((route, index) => (
                <li className="account-row" key={route.provider}>
                  <div className="account-row__main">
                    <p className="account-row__name">{index + 1}. {route.provider}/{route.model}</p>
                    <p className="account-row__meta">{route.enabled ? (route.isDefault ? "DEFAULT" : "FALLBACK") : "DISABLED"}</p>
                  </div>
                  <StatusPill tone={route.enabled ? "healthy" : "neutral"}>{route.enabled ? "Enabled" : "Disabled"}</StatusPill>
                </li>
              ))}
            </ol>
            <div className="form-actions">
              <Link className="button" href="/routing">Edit routing <ArrowRight aria-hidden="true" /></Link>
            </div>
          </section>

          <section className="workspace-section">
            <div className="section-head">
              <h2>Connect an MCP client</h2>
              <p>Use HTTP for a long-running local service or stdio when the client should own the ImageRouter process.</p>
            </div>
            <div className="split-layout">
              <div>
                <h3>Streamable HTTP</h3>
                <div className="code-sample">
                  <pre><code>{httpConfig}</code></pre>
                  <CopyButton value={httpConfig} />
                </div>
              </div>
              <div>
                <h3>stdio</h3>
                <div className="code-sample">
                  <pre><code>{STDIO_SNIPPET}</code></pre>
                  <CopyButton value={STDIO_SNIPPET} />
                </div>
              </div>
            </div>
          </section>

          <section className="workspace-section">
            <div className="section-head">
              <h2>Readiness</h2>
              <p>ImageRouter remains local and keeps image bytes transient unless a caller supplies an output path.</p>
            </div>
            <ul className="check-list">
              <li><CheckCircle2 aria-hidden="true" /><span>MCP stdio and Streamable HTTP are available.</span></li>
              <li>{status.prompts?.state === "ready" ? <CheckCircle2 aria-hidden="true" /> : <Circle data-pending="true" aria-hidden="true" />}<span>{status.prompts?.state === "ready" ? `Local prompt index ready (${status.prompts.totalTemplates.toLocaleString()} templates).` : "Bundle the prompt snapshots to enable local template search."}</span></li>
              <li>{ready ? <CheckCircle2 aria-hidden="true" /> : <Circle data-pending="true" aria-hidden="true" />}<span>{ready ? "At least one provider account is configured." : "Add one provider account to generate images."}</span></li>
              <li>{status.healthyAccounts ? <CheckCircle2 aria-hidden="true" /> : <Circle data-pending="true" aria-hidden="true" />}<span>{status.healthyAccounts ? "A connector passed its latest health check." : "Test a provider account before relying on fallback."}</span></li>
              <li><Radio aria-hidden="true" /><span>Activity records metadata only—never prompts or image data.</span></li>
            </ul>
            {!ready ? <div className="form-actions"><Link className="button button--primary" href="/providers">Add provider <ArrowRight aria-hidden="true" /></Link></div> : null}
          </section>
        </>
      ) : null}
    </>
  );
}
