"use client";

import { ArrowRight, ExternalLink, Library, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

export function PromptsWorkbench() {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("auto");
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState(null);
  const [openPreview, setOpenPreview] = useState(null);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => { api("/api/prompts/status").then(setStatus).catch(setError); }, []);

  async function search(event) {
    event?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, provider, limit: "3" });
      setResults(await api(`/api/prompts?${params}`));
    } catch (searchError) { setError(searchError); }
    finally { setSearching(false); }
  }

  return (
    <>
      <PageHeader title="Prompt library" description="Search bundled prompt packs locally, inspect provenance, then hand a selected template to the Playground or an MCP agent." actions={<StatusPill tone={status?.state === "ready" ? "healthy" : "warning"}>{status?.state === "ready" ? "Index ready" : status?.state === "degraded" ? "Index partial" : "Pack setup required"}</StatusPill>} />
      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {status?.state === "unavailable" ? <Notice tone="warning"><p>Prompt snapshots are not bundled in this checkout yet. ImageRouter remains usable with raw or LLM-only enhancement; no prompt data is downloaded at runtime.</p></Notice> : null}
      {status?.state === "degraded" ? <Notice tone="warning"><p>One or more release snapshots failed validation. The valid pack remains searchable; rebuild the index with a matching release manifest before relying on every source.</p></Notice> : null}

      <section className="workspace-section">
        <div className="runtime-line">
          <div className="runtime-line__item"><span className="runtime-line__label">Index</span><span className="runtime-line__value">{status?.state || "loading"}</span></div>
          <div className="runtime-line__item"><span className="runtime-line__label">Templates</span><span className="runtime-line__value">{status?.totalTemplates?.toLocaleString() || "—"}</span></div>
          <div className="runtime-line__item"><span className="runtime-line__label">Revision</span><span className="runtime-line__value">{status?.updatedAt || "release snapshot"}</span></div>
        </div>
        {status ? <div className="prompt-route-list">{(status.packs || []).map((pack) => <div className="prompt-route-row" key={pack.id}><div className="prompt-route-row__main"><strong>{pack.name || pack.id}</strong><p className="prompt-route-row__meta">{pack.count || "—"} prompts · {pack.license || "license recorded in snapshot"}</p></div><span className="machine">{pack.sourceRepo || "bundled"}</span><StatusPill tone="neutral">Release pinned</StatusPill></div>)}</div> : <LoadingBlock />}
      </section>

      <section className="workspace-section">
        <div className="section-head"><h2>Find a starting point</h2><p>Results stay local and return the full prompt plus source attribution. Preview images are only requested when you open one.</p></div>
        <form className="prompt-search" onSubmit={search}>
          <div className="prompt-search__controls">
            <div className="field"><label htmlFor="prompt-query">Need</label><input className="input" id="prompt-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="A clean product launch poster for a developer tool" /></div>
            <div className="field"><label htmlFor="prompt-provider">Image provider</label><select className="select" id="prompt-provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="auto">Auto</option><option value="xai">xAI</option><option value="antigravity">Antigravity</option><option value="codex">Codex</option></select></div>
            <button className="button button--primary" type="submit" disabled={!query.trim() || searching} data-state={searching ? "loading" : "default"}><Search aria-hidden="true" /> {searching ? "Searching…" : "Search"}</button>
          </div>
        </form>
        {!results ? <div className="empty-state"><Library aria-hidden="true" /><h2>Search the local packs.</h2><p>Use a short description of the visual job, subject or format.</p></div> : results.results.length === 0 ? <div className="empty-state"><Search aria-hidden="true" /><h2>No compatible template.</h2><p>Try a use case, subject or style. Auto generation can still proceed without a template.</p></div> : (
          <div className="prompt-results">
            {results.results.map((item, index) => <article className="prompt-result" key={item.id}>
              <div className="prompt-result__head"><div><h2>{index + 1}. {item.title}</h2><p>{item.description || "No description supplied by the source."}</p></div><StatusPill tone={item.needsReferenceImage ? "warning" : "neutral"}>{item.needsReferenceImage ? "Reference needed" : "Text to image"}</StatusPill></div>
              <div className="prompt-result__meta"><span>Score {item.score}</span><span>{item.sources?.map((source) => source.packId).join(" · ")}</span><span>{item.license}</span></div>
              <pre className="prompt-result__prompt">{item.prompt}</pre>
              <div className="prompt-result__sources"><span>{item.attribution}</span>{item.sourceLink ? <a className="text-link" href={item.sourceLink} target="_blank" rel="noreferrer">Source <ExternalLink aria-hidden="true" /></a> : null}</div>
              <div className="form-actions"><Link className="button button--primary button--compact" href={`/playground?template_id=${encodeURIComponent(item.id)}&template_title=${encodeURIComponent(item.title)}`}><ArrowRight aria-hidden="true" /> Use in Playground</Link>{item.previewUrls?.[0] ? <button className="button button--compact" type="button" onClick={() => setOpenPreview(openPreview === item.id ? null : item.id)}>{openPreview === item.id ? "Hide preview" : "Show preview"}</button> : null}</div>
              {openPreview === item.id && item.previewUrls?.[0] ? <img className="prompt-result__preview" src={`/api/prompts/preview?url=${encodeURIComponent(item.previewUrls[0])}`} alt={`Sample for ${item.title}`} loading="lazy" /> : null}
            </article>)}
          </div>
        )}
      </section>
    </>
  );
}
