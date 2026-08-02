"use client";

import { Activity, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

export function ActivityWorkbench() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try { const payload = await api("/api/activity?limit=100"); setRows(payload.activity); setError(null); }
    catch (loadError) { setError(loadError); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    let active = true;
    api("/api/activity?limit=100")
      .then((payload) => { if (active) setRows(payload.activity); })
      .catch((loadError) => { if (active) setError(loadError); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <PageHeader title="Request activity" description="Operational metadata only. Prompts and image bytes never enter this table." actions={<button className="button" type="button" onClick={load} disabled={refreshing} data-state={refreshing ? "loading" : "default"}><RefreshCw aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}</button>} />
      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? (
        <div className="empty-state"><Activity aria-hidden="true" /><h2>No requests recorded.</h2><p>Run one transient image request to verify routing without writing a file.</p><Link className="button" href="/playground">Open playground</Link></div>
      ) : (
        <table className="data-table">
          <thead><tr><th style={{ width: "17%" }}>Time</th><th style={{ width: "21%" }}>Actual route</th><th>Prompt</th><th>Enhancer</th><th>Duration</th><th>Status</th><th>Fallbacks</th><th>Output path</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td data-label="Time" className="machine">{formatTime(row.timestamp)}</td><td data-label="Actual route" className="machine">{row.provider ? `${row.provider}/${row.model || "—"}` : "—"}</td><td data-label="Prompt" className="machine">{row.promptMode || "raw"}{row.templatePack ? ` · ${row.templatePack}` : ""}</td><td data-label="Enhancer" className="machine">{row.enhancerProvider ? `${row.enhancerProvider}/${row.enhancerModel || "—"}` : "Local"}</td><td data-label="Duration" className="machine">{row.durationMs} ms</td><td data-label="Status"><StatusPill tone={row.status === "success" ? "healthy" : "error"}>{row.errorCode || row.status}</StatusPill></td><td data-label="Fallbacks" className="machine">{row.fallbackCount}</td><td data-label="Output path" className="machine">{row.outputPath || "Transient"}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}
