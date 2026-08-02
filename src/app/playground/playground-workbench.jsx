"use client";

import { Image as ImageIcon, Play, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function PlaygroundWorkbench() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("auto");
  const [promptMode, setPromptMode] = useState("auto");
  const [modeOverride, setModeOverride] = useState(null);
  const [templateId, setTemplateId] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [reference, setReference] = useState(null);
  const [referenceName, setReferenceName] = useState("");
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const objectUrl = useRef(null);
  const searchParams = useSearchParams();
  const urlTemplateId = searchParams.get("template_id") || "";
  const urlTemplateTitle = searchParams.get("template_title") || "";
  const selectedTemplateId = templateId || urlTemplateId;
  const selectedTemplateTitle = templateTitle || urlTemplateTitle;
  const selectedPromptMode = modeOverride || (urlTemplateId ? "template" : promptMode);

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  function setPreview(base64, mimeType) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(new Blob([bytesFromBase64(base64)], { type: mimeType }));
    return objectUrl.current;
  }

  function loadReference(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setReference(String(reader.result)); setReferenceName(file.name); };
    reader.readAsDataURL(file);
  }

  async function generate(event) {
    event.preventDefault();
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    setState("loading");
    setError(null);
    setResult(null);
    try {
      const payload = await api("/api/playground", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          provider,
          prompt_mode: selectedPromptMode,
          template_id: selectedPromptMode === "template" ? selectedTemplateId || undefined : undefined,
          reference_images: reference ? [reference] : [],
          aspect_ratio: aspectRatio || undefined,
        }),
      });
      const url = setPreview(payload.image, payload.mimeType);
      setResult({ ...payload, url });
      setState("success");
    } catch (generateError) {
      setError(generateError);
      setState("error");
    }
  }

  return (
    <>
      <PageHeader title="Transient playground" description="Test raw, auto-enhanced or selected-template generation. The preview lives in an object URL and is revoked when replaced or when you leave." />
      <div className="playground-layout">
        <form className="form-grid" onSubmit={generate}>
          <div className="field">
            <label htmlFor="prompt">Prompt</label>
            <textarea className="textarea" id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A cobalt blueprint of a compact orbital camera, precise ink lines on cool paper" required aria-invalid={state === "error" && !prompt ? "true" : undefined} />
            <span className="field__helper">Auto keeps your intent authoritative, then adds compatible visual structure when a template or enhancer is available.</span>
          </div>
          <div className="form-row">
            <div className="field"><label htmlFor="prompt-mode">Prompt mode</label><select className="select" id="prompt-mode" value={selectedPromptMode} onChange={(event) => { setModeOverride(event.target.value); setPromptMode(event.target.value); }}><option value="auto">Auto · search + enhance</option><option value="raw">Raw · preserve exactly</option><option value="template">Template · selected below</option></select><span className="field__helper">Use the Prompts screen to choose a template explicitly.</span></div>
            <div className="field"><label htmlFor="provider">Provider override</label><select className="select" id="provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="auto">Auto · route chain</option><option value="xai">xAI only</option><option value="antigravity">Antigravity only</option><option value="codex">Codex only</option></select><span className="field__helper">Explicit providers still try their other accounts.</span></div>
          </div>
          {selectedPromptMode === "template" ? <div className="field"><label htmlFor="template-id">Template ID</label><input className="input machine" id="template-id" value={selectedTemplateId} onChange={(event) => setTemplateId(event.target.value)} placeholder="tpl_…" required /><span className="field__helper">{selectedTemplateTitle ? `Selected: ${selectedTemplateTitle}` : "Paste an ID from the Prompts screen."}</span></div> : null}
          <div className="form-row">
            <div className="field"><label htmlFor="aspect">Aspect ratio</label><select className="select machine" id="aspect" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="">Provider default</option><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:2">3:2</option><option value="2:3">2:3</option></select><span className="field__helper">Unsupported routes are skipped only in auto mode.</span></div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="reference-file">Reference image</label>
            {reference ? <div className="token-line"><span className="token-value">{referenceName}</span><button className="button button--quiet icon-button" type="button" onClick={() => { setReference(null); setReferenceName(""); }} aria-label="Remove reference image"><X aria-hidden="true" /></button></div> : <input className="input file-input" id="reference-file" type="file" accept="image/*" onChange={loadReference} />}
            <span className="field__helper">One inline image here; the MCP tool accepts the connector’s full supported count.</span>
          </div>
          {error ? <Notice tone="error"><p>{error.code}: {error.message}</p></Notice> : null}
          <div className="form-actions"><button className="button button--primary" type="submit" disabled={!prompt.trim() || state === "loading"} data-state={state}><Play aria-hidden="true" /> {state === "loading" ? "Generating…" : "Generate image"}</button><span className="field__helper">No file is written.</span></div>
        </form>

        <div>
          <div className="preview-stage" aria-live="polite">
            {state === "loading" ? <div className="preview-stage__loading"><span className="spinner" aria-hidden="true" /><span>Generating one image…</span></div> : result ? <img src={result.url} width="1024" height="1024" alt="Generated playground result" /> : <div className="preview-stage__empty"><ImageIcon aria-hidden="true" /><p>Your transient result appears here.</p></div>}
          </div>
          {result ? <><div className="preview-meta"><span>Provider <strong>{result.provider}</strong></span><span>Model <strong>{result.model}</strong></span><span>Time <strong>{result.durationMs} ms</strong></span><span>Prompt <strong>{result.promptPipeline?.mode || selectedPromptMode}</strong></span><StatusPill tone={result.fellBack ? "warning" : "healthy"}>{result.fellBack ? "Fallback used" : "Default path"}</StatusPill></div><ul className="attempt-list">{result.attempts.map((attempt, index) => <li key={`${attempt.provider}-${attempt.accountId}-${index}`}><strong>{attempt.provider}/{attempt.model} · {attempt.status}</strong><code>{attempt.accountLabel || "route check"} · {attempt.code || "OK"} · {attempt.durationMs} ms</code></li>)}</ul><div className="prompt-pipeline"><div className="prompt-pipeline__stages">{result.promptPipeline?.selectedTemplate ? <span>Template: {result.promptPipeline.selectedTemplate.title}</span> : <span>No template selected</span>}<span>Planner: {result.promptPipeline?.planner?.provider || "local search"}</span><span>Enhancer: {result.promptPipeline?.enhancer?.provider || "local fallback"}</span>{(result.promptPipeline?.warnings || []).map((warning) => <span key={warning}>{warning}</span>)}</div><details><summary>Final English prompt</summary><pre className="prompt-pipeline__prompt">{result.promptPipeline?.finalPrompt || "—"}</pre></details></div></> : null}
          {error?.attempts?.length ? <ul className="attempt-list">{error.attempts.map((attempt, index) => <li key={`${attempt.provider}-${index}`}><strong>{attempt.provider}/{attempt.model} · {attempt.status}</strong><code>{attempt.code} · {attempt.message}</code></li>)}</ul> : null}
        </div>
      </div>
    </>
  );
}
