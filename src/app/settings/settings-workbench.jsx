"use client";

import { Eye, KeyRound, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

export function SettingsWorkbench() {
  const [settings, setSettings] = useState(null);
  const [token, setToken] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const rotateDialog = useRef(null);

  useEffect(() => { api("/api/settings").then(setSettings).catch(setError); }, []);

  async function reveal() {
    try { const payload = await api("/api/settings?reveal=true"); setToken(payload.httpToken); }
    catch (revealError) { setError(revealError); }
  }

  async function rotate() {
    try {
      const payload = await api("/api/settings/token", { method: "POST" });
      setToken(payload.httpToken);
      rotateDialog.current?.close();
    } catch (rotateError) { setError(rotateError); }
  }

  async function save(event) {
    event.preventDefault();
    setState("loading");
    setError(null);
    try {
      const payload = await api("/api/settings", { method: "PATCH", body: JSON.stringify({ httpPort: Number(settings.httpPort), requestTimeoutMs: Number(settings.requestTimeoutMs), promptModeDefault: settings.promptModeDefault, enhancerEnabled: settings.enhancerEnabled, enhancerTimeoutMs: Number(settings.enhancerTimeoutMs) }) });
      setSettings(payload);
      setState("success");
      setTimeout(() => setState("idle"), 1800);
    } catch (saveError) { setState("error"); setError(saveError); }
  }

  return (
    <>
      <PageHeader title="Local runtime settings" description="ImageRouter binds to loopback only. Port changes apply the next time the dashboard server starts." />
      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {!settings ? <LoadingBlock /> : (
        <form onSubmit={save}>
          <section className="workspace-section">
            <div className="settings-row">
              <div className="settings-row__copy"><h2>HTTP bearer token</h2><p>Required by `/mcp` and `/v1/images/generations`.</p></div>
              <div className="settings-row__control"><div className="token-line"><span className="token-value">{token || settings.httpToken}</span><button className="button" type="button" onClick={reveal}><Eye aria-hidden="true" /> Reveal</button>{token ? <CopyButton value={token} compact={false} /> : null}<button className="button button--danger" type="button" onClick={() => rotateDialog.current?.showModal()}><RefreshCw aria-hidden="true" /> Rotate</button></div><span className="field__helper">Rotating immediately invalidates every existing HTTP MCP and REST client.</span></div>
            </div>
            <div className="settings-row">
              <div className="settings-row__copy"><h2>Default prompt mode</h2><p>Auto selects a local template and enhances it when a configured text connector is available.</p></div>
              <div className="settings-row__control field"><label htmlFor="prompt-mode-default">Mode</label><select className="select" id="prompt-mode-default" value={settings.promptModeDefault} onChange={(event) => setSettings((current) => ({ ...current, promptModeDefault: event.target.value }))}><option value="auto">Auto enhance</option><option value="raw">Raw prompt</option></select><span className="field__helper">Individual MCP/REST calls can override this value.</span></div>
            </div>
            <div className="settings-row">
              <div className="settings-row__copy"><h2>Prompt enhancer</h2><p>Uses the separate enhancer route chain. Failed text calls fall back to local template compilation.</p></div>
              <div className="settings-row__control field"><label className="toggle"><input type="checkbox" checked={settings.enhancerEnabled} onChange={(event) => setSettings((current) => ({ ...current, enhancerEnabled: event.target.checked }))} /><span>Enable LLM enhancement</span></label><label htmlFor="enhancer-timeout">Enhancer timeout in milliseconds</label><input className="input machine" id="enhancer-timeout" type="number" min="1000" max="120000" step="1000" value={settings.enhancerTimeoutMs} onChange={(event) => setSettings((current) => ({ ...current, enhancerTimeoutMs: event.target.value }))} /><span className="field__helper">No prompt or final prompt is written to activity or SQLite.</span></div>
            </div>
            <div className="settings-row">
              <div className="settings-row__copy"><h2>HTTP port</h2><p>Dashboard, MCP HTTP and REST share one local port.</p></div>
              <div className="settings-row__control field"><label htmlFor="http-port">Port</label><input className="input machine" id="http-port" type="number" min="1" max="65535" value={settings.httpPort} onChange={(event) => setSettings((current) => ({ ...current, httpPort: event.target.value }))} /><span className="field__helper">Restart required after saving.</span></div>
            </div>
            <div className="settings-row">
              <div className="settings-row__copy"><h2>Provider timeout</h2><p>Applies to each account attempt, not the full route chain.</p></div>
              <div className="settings-row__control field"><label htmlFor="request-timeout">Timeout in milliseconds</label><input className="input machine" id="request-timeout" type="number" min="1000" max="600000" step="1000" value={settings.requestTimeoutMs} onChange={(event) => setSettings((current) => ({ ...current, requestTimeoutMs: event.target.value }))} /><span className="field__helper">Long image jobs generally need 60,000–180,000 ms.</span></div>
            </div>
            <div className="settings-row">
              <div className="settings-row__copy"><h2>Data directory</h2><p>A dedicated ImageRouter profile; data from previous router installations is never read.</p></div>
              <div className="settings-row__control"><div className="token-value">{settings.dataPath}</div><span className="field__helper">SQLite stores metadata and encrypted credentials only.</span></div>
            </div>
            <div className="form-actions"><button className="button button--primary" type="submit" disabled={state === "loading"} data-state={state}><Save aria-hidden="true" /> {state === "loading" ? "Saving…" : state === "success" ? "Saved" : "Save settings"}</button></div>
          </section>
          <section className="workspace-section">
            <div className="section-head"><h2>Connector warnings</h2><p>xAI uses a published image API. Codex and Antigravity are guarded experimental adapters.</p></div>
            <div className="form-grid"><Notice tone="warning"><p><strong>Antigravity.</strong> Its private Code Assist endpoint and client fingerprint may change.</p></Notice><Notice tone="warning"><p><strong>Codex.</strong> Image generation needs an eligible ChatGPT plan and can change with the private Responses endpoint.</p></Notice></div>
          </section>
        </form>
      )}

      <dialog className="dialog" ref={rotateDialog}>
        <div className="dialog__head"><div><h2>Rotate the HTTP token?</h2><p>Connected HTTP clients will fail until their configuration is updated.</p></div><button className="button button--quiet icon-button" type="button" onClick={() => rotateDialog.current?.close()} aria-label="Close dialog"><X aria-hidden="true" /></button></div>
        <div className="dialog__body"><Notice tone="warning"><p>This action cannot restore the previous token.</p></Notice></div>
        <div className="dialog__actions"><button className="button" type="button" autoFocus onClick={() => rotateDialog.current?.close()}>Keep token</button><button className="button button--danger" type="button" onClick={rotate}><KeyRound aria-hidden="true" /> Rotate token</button></div>
      </dialog>
    </>
  );
}
