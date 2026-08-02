"use client";

import { ArrowDown, ArrowUp, Check, FlaskConical, Plus, Power, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

const MARKS = { xai: "/xai-mark.svg", antigravity: "/antigravity-mark.svg", codex: "/codex-mark.svg" };

function ConnectionDialog({ provider, onClose, onConnected }) {
  const dialogRef = useRef(null);
  const labelRef = useRef(null);
  const [authType, setAuthType] = useState(provider.id === "xai" ? "api_key" : "oauth");
  const [form, setForm] = useState({ label: "", apiKey: "", accessToken: "", refreshToken: "", projectId: "", chatgptAccountId: "" });
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [flowId, setFlowId] = useState(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    setTimeout(() => labelRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!flowId) return;
    const interval = setInterval(async () => {
      try {
        const result = await api(`/api/oauth/status/${flowId}`);
        if (result.status === "complete") {
          clearInterval(interval);
          setState("success");
          setTimeout(() => { dialogRef.current?.close(); onConnected(); }, 400);
        } else if (result.status === "error") {
          clearInterval(interval);
          setState("error");
          setError(result.error);
        }
      } catch (pollError) {
        clearInterval(interval);
        setState("error");
        setError(pollError.message);
      }
    }, 1200);
    return () => clearInterval(interval);
  }, [flowId, onConnected]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function startOAuth() {
    const popup = window.open("about:blank", "imagerouter-oauth", "popup,width=680,height=760");
    setState("loading");
    setError(null);
    try {
      const flow = await api(`/api/oauth/${provider.id}/start`, { method: "POST", body: JSON.stringify({ label: form.label }) });
      setFlowId(flow.id);
      if (popup) popup.location = flow.authorizationUrl;
      else window.location.assign(flow.authorizationUrl);
    } catch (startError) {
      popup?.close();
      setState("error");
      setError(startError.message);
    }
  }

  async function saveToken(event) {
    event.preventDefault();
    setState("loading");
    setError(null);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({
          provider: provider.id,
          label: form.label || `${provider.shortName} account`,
          authType,
          credentials: authType === "api_key"
            ? { apiKey: form.apiKey }
            : {
              accessToken: form.accessToken,
              refreshToken: form.refreshToken || undefined,
              projectId: form.projectId || undefined,
              chatgptAccountId: form.chatgptAccountId || undefined,
            },
        }),
      });
      setState("success");
      setTimeout(() => { dialogRef.current?.close(); onConnected(); }, 300);
    } catch (saveError) {
      setState("error");
      setError(saveError.message);
    }
  }

  return (
    <dialog className="dialog" ref={dialogRef} onClose={onClose}>
      <div className="dialog__head">
        <div><h2>Add {provider.name}</h2><p>Credentials stay encrypted in the local ImageRouter data directory.</p></div>
        <button className="button button--quiet icon-button" type="button" onClick={() => dialogRef.current?.close()} aria-label="Close dialog"><X aria-hidden="true" /></button>
      </div>
      <form onSubmit={saveToken}>
        <div className="dialog__body form-grid">
          <div className="field">
            <label htmlFor="connection-label">Account label</label>
            <input ref={labelRef} className="input" id="connection-label" value={form.label} onChange={(event) => update("label", event.target.value)} placeholder={`${provider.shortName} personal`} />
            <span className="field__helper">Used only to identify this account in fallback attempts.</span>
          </div>

          <fieldset className="field">
            <legend className="field__label">Authentication</legend>
            <div className="radio-line">
              <label className="radio-option"><input type="radio" name="auth" value="oauth" checked={authType === "oauth"} onChange={() => setAuthType("oauth")} /><span><strong>OAuth</strong><span>Open the provider sign-in flow in a separate window.</span></span></label>
              {provider.id === "xai" ? <label className="radio-option"><input type="radio" name="auth" value="api_key" checked={authType === "api_key"} onChange={() => setAuthType("api_key")} /><span><strong>API key</strong><span>Use a key from the xAI console.</span></span></label> : null}
              {provider.id !== "xai" ? <label className="radio-option"><input type="radio" name="auth" value="token" checked={authType === "token"} onChange={() => setAuthType("token")} /><span><strong>Manual token</strong><span>Diagnostic path for an existing OAuth token.</span></span></label> : null}
            </div>
          </fieldset>

          {authType === "api_key" ? (
            <div className="field"><label htmlFor="api-key">xAI API key</label><input className="input machine" id="api-key" type="password" autoComplete="off" required value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} /><span className="field__helper">The full key is never returned by any ImageRouter API.</span></div>
          ) : null}

          {authType === "token" ? (
            <>
              <div className="field"><label htmlFor="access-token">Access token</label><textarea className="textarea machine" id="access-token" required value={form.accessToken} onChange={(event) => update("accessToken", event.target.value)} /></div>
              <div className="field"><label htmlFor="refresh-token">Refresh token</label><textarea className="textarea machine" id="refresh-token" value={form.refreshToken} onChange={(event) => update("refreshToken", event.target.value)} /><span className="field__helper">Optional, but account fallback cannot recover an expired token without it.</span></div>
              {provider.id === "antigravity" ? <div className="field"><label htmlFor="project-id">Code Assist project ID</label><input className="input machine" id="project-id" required value={form.projectId} onChange={(event) => update("projectId", event.target.value)} /></div> : null}
              {provider.id === "codex" ? <div className="field"><label htmlFor="account-id">ChatGPT account ID</label><input className="input machine" id="account-id" value={form.chatgptAccountId} onChange={(event) => update("chatgptAccountId", event.target.value)} /><span className="field__helper">Optional when the token already carries the account claim.</span></div> : null}
            </>
          ) : null}

          {authType === "oauth" ? <Notice tone={provider.id === "xai" ? "neutral" : "warning"}><p>{provider.id === "xai" ? "A loopback callback runs on localhost for five minutes." : "This experimental OAuth connector depends on private upstream behavior."}</p></Notice> : null}
          {error ? <Notice tone="error"><p>{error}</p></Notice> : null}
        </div>
        <div className="dialog__actions">
          <button className="button" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
          {authType === "oauth" ? <button className="button button--primary" type="button" onClick={startOAuth} disabled={state === "loading"} data-state={state}>{state === "loading" ? "Waiting for OAuth…" : state === "success" ? "Connected" : "Open OAuth"}</button> : <button className="button button--primary" type="submit" disabled={state === "loading"} data-state={state}>{state === "loading" ? "Saving…" : state === "success" ? "Saved" : "Save account"}</button>}
        </div>
      </form>
    </dialog>
  );
}

export function ProvidersWorkbench() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [dialogProvider, setDialogProvider] = useState(null);
  const [testing, setTesting] = useState(null);

  async function load() {
    try { setStatus(await api("/api/status")); setError(null); } catch (loadError) { setError(loadError); }
  }
  useEffect(() => {
    let active = true;
    api("/api/status")
      .then((payload) => { if (active) setStatus(payload); })
      .catch((loadError) => { if (active) setError(loadError); });
    return () => { active = false; };
  }, []);

  async function toggle(connection) {
    try {
      await api(`/api/providers/${connection.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !connection.enabled }) });
      await load();
    } catch (toggleError) { setError(toggleError); }
  }

  async function test(connection) {
    setTesting(connection.id);
    try { await api(`/api/providers/${connection.id}/test`, { method: "POST" }); } catch (testError) { setError(testError); }
    finally { setTesting(null); await load(); }
  }

  async function move(provider, index, direction) {
    const ids = provider.accounts.map((account) => account.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try { await api("/api/providers/reorder", { method: "PUT", body: JSON.stringify({ provider: provider.id, orderedIds: ids }) }); await load(); }
    catch (moveError) { setError(moveError); }
  }

  return (
    <>
      <PageHeader title="Provider accounts" description="Only three image connectors exist here. Accounts are attempted top to bottom within each provider." />
      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {!status ? <LoadingBlock /> : (
        <div className="provider-list">
          {status.providers.map((provider) => (
            <section className="provider-block" key={provider.id}>
              <div className="provider-block__head">
                <div className="provider-identity">
                  <img className="provider-mark" src={MARKS[provider.id]} width="42" height="42" alt="" />
                  <div><h2>{provider.name}</h2><p>{provider.models.length} image model{provider.models.length === 1 ? "" : "s"} · {provider.accounts.length} account{provider.accounts.length === 1 ? "" : "s"}</p></div>
                </div>
                <div className="provider-block__actions">
                  <StatusPill tone={provider.stability === "Stable" ? "healthy" : "experimental"}>{provider.stability}</StatusPill>
                  <button className="button" type="button" onClick={() => setDialogProvider(provider)}><Plus aria-hidden="true" /> Add account</button>
                </div>
              </div>
              {provider.warning ? <div style={{ marginTop: "var(--space-4)" }}><Notice tone="warning"><p>{provider.warning}</p></Notice></div> : null}
              <div className="account-list">
                {provider.accounts.length ? provider.accounts.map((connection, index) => (
                  <div className="account-row" key={connection.id}>
                    <div className="account-row__main">
                      <p className="account-row__name">{connection.label}</p>
                      <p className="account-row__meta">P{index + 1} · {connection.authType.toUpperCase()} · {connection.lastCheckedAt ? `CHECKED ${new Date(connection.lastCheckedAt).toLocaleString()}` : "NOT TESTED"}</p>
                      {connection.lastError ? <p className="field__helper" data-tone="error">{connection.lastErrorCode}: {connection.lastError}</p> : null}
                    </div>
                    <div className="account-row__actions">
                      <StatusPill tone={connection.enabled ? connection.status : "neutral"}>{connection.enabled ? connection.status : "disabled"}</StatusPill>
                      <button className="button button--quiet icon-button" type="button" onClick={() => move(provider, index, -1)} disabled={index === 0} aria-label={`Move ${connection.label} up`}><ArrowUp aria-hidden="true" /></button>
                      <button className="button button--quiet icon-button" type="button" onClick={() => move(provider, index, 1)} disabled={index === provider.accounts.length - 1} aria-label={`Move ${connection.label} down`}><ArrowDown aria-hidden="true" /></button>
                      <button className="button button--compact" type="button" onClick={() => test(connection)} disabled={testing === connection.id} data-state={testing === connection.id ? "loading" : "default"}><FlaskConical aria-hidden="true" /> {testing === connection.id ? "Testing…" : "Test"}</button>
                      <button className="button button--quiet icon-button" type="button" onClick={() => toggle(connection)} aria-label={`${connection.enabled ? "Disable" : "Enable"} ${connection.label}`} title={connection.enabled ? "Disable account" : "Enable account"}>{connection.enabled ? <Power aria-hidden="true" /> : <Check aria-hidden="true" />}</button>
                    </div>
                  </div>
                )) : <p className="empty-inline">No account configured. Auto mode will skip this provider.</p>}
              </div>
            </section>
          ))}
        </div>
      )}
      {dialogProvider ? <ConnectionDialog key={dialogProvider.id} provider={dialogProvider} onClose={() => setDialogProvider(null)} onConnected={() => { setDialogProvider(null); load(); }} /> : null}
    </>
  );
}
