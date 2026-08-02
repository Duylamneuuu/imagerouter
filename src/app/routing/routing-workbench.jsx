"use client";

import { ArrowDown, ArrowUp, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LoadingBlock } from "@/components/LoadingBlock";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/api";

const MARKS = { xai: "/xai-mark.svg", antigravity: "/antigravity-mark.svg", codex: "/codex-mark.svg" };

export function RoutingWorkbench() {
  const [routes, setRoutes] = useState(null);
  const [providers, setProviders] = useState([]);
  const [enhancerRoutes, setEnhancerRoutes] = useState(null);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api("/api/routes"), api("/api/status"), api("/api/enhancer-routes")])
      .then(([routeData, status, enhancerData]) => { setRoutes(routeData.routes); setFallbackEnabled(routeData.fallbackEnabled); setProviders(status.providers); setEnhancerRoutes(enhancerData.routes); })
      .catch(setError);
  }, []);

  const providerMap = useMemo(() => Object.fromEntries(providers.map((provider) => [provider.id, provider])), [providers]);
  const defaultIndex = routes?.findIndex((route) => route.enabled) ?? -1;

  function move(index, direction) {
    const target = index + direction;
    if (!routes || target < 0 || target >= routes.length) return;
    const next = [...routes];
    [next[index], next[target]] = [next[target], next[index]];
    setRoutes(next);
    setSaveState("idle");
  }

  function update(index, patch) {
    setRoutes((current) => current.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route));
    setSaveState("idle");
  }

  function moveEnhancer(index, direction) {
    const target = index + direction;
    if (!enhancerRoutes || target < 0 || target >= enhancerRoutes.length) return;
    const next = [...enhancerRoutes];
    [next[index], next[target]] = [next[target], next[index]];
    setEnhancerRoutes(next);
    setSaveState("idle");
  }

  function updateEnhancer(index, patch) {
    setEnhancerRoutes((current) => current.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route));
    setSaveState("idle");
  }

  async function save() {
    setSaveState("loading");
    setError(null);
    try {
      const [result] = await Promise.all([
        api("/api/routes", { method: "PUT", body: JSON.stringify({ routes, fallbackEnabled }) }),
        api("/api/enhancer-routes", { method: "PUT", body: JSON.stringify({ routes: enhancerRoutes }) }),
      ]);
      setRoutes(result.routes);
      setFallbackEnabled(result.fallbackEnabled);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 1800);
    } catch (saveError) { setSaveState("error"); setError(saveError); }
  }

  return (
    <>
      <PageHeader title="Ordered route chains" description="Image generation and prompt enhancement have separate ordered routes. The first enabled entry in each chain is its default." actions={<button className="button button--primary" type="button" onClick={save} disabled={!routes || !enhancerRoutes || saveState === "loading"} data-state={saveState}><Save aria-hidden="true" /> {saveState === "loading" ? "Saving…" : saveState === "success" ? "Saved" : "Save routing"}</button>} />
      {error ? <Notice tone="error"><p>{error.message}</p></Notice> : null}
      {!routes ? <LoadingBlock /> : (
        <>
          <section className="workspace-section">
            <div className="section-head"><h2>Fallback policy</h2><p>Transient failures can continue down the chain. Invalid prompts, safety rejection, capability mismatch and output-path errors stop immediately.</p></div>
            <label className="toggle"><input type="checkbox" checked={fallbackEnabled} onChange={(event) => { setFallbackEnabled(event.target.checked); setSaveState("idle"); }} /><span>Enable cross-provider fallback in auto mode</span></label>
          </section>
          <section className="workspace-section">
            <div className="section-head"><h2>Prompt enhancer route</h2><p>Auto mode uses this chain for translation, template remix and final English prompt preparation. A failed enhancer falls back locally and does not stop image generation.</p></div>
            <div className="prompt-route-list">
              {enhancerRoutes?.map((route, index) => {
                const provider = providerMap[route.provider];
                const textModels = provider?.textModels || [];
                return <div className="prompt-route-row" key={route.provider}>
                  <div className="prompt-route-row__main"><strong>{index + 1}. {provider?.name || route.provider}</strong><p className="prompt-route-row__meta">{route.enabled ? (route.isDefault ? "DEFAULT" : "FALLBACK") : "DISABLED"} · provider accounts are tried by priority</p></div>
                  <div className="field"><label htmlFor={`enhancer-model-${route.provider}`}>Text model</label><select className="select machine" id={`enhancer-model-${route.provider}`} value={route.model} onChange={(event) => updateEnhancer(index, { model: event.target.value })}>{textModels.length ? textModels.map((model) => <option key={model.id} value={model.id}>{model.id}</option>) : <option value={route.model}>{route.model}</option>}</select></div>
                  <div className="form-actions"><label className="toggle"><input type="checkbox" checked={route.enabled} onChange={(event) => updateEnhancer(index, { enabled: event.target.checked })} /><span>Enabled</span></label><button className="button button--quiet icon-button" type="button" disabled={index === 0} onClick={() => moveEnhancer(index, -1)} aria-label={`Move ${route.provider} enhancer up`}><ArrowUp aria-hidden="true" /></button><button className="button button--quiet icon-button" type="button" disabled={index === enhancerRoutes.length - 1} onClick={() => moveEnhancer(index, 1)} aria-label={`Move ${route.provider} enhancer down`}><ArrowDown aria-hidden="true" /></button></div>
                </div>;
              })}
            </div>
          </section>
          <section className="workspace-section">
            <div className="section-head"><h2>Routes</h2><p>Account priority is configured on the Providers screen and runs inside each row before the next row begins.</p></div>
            <div className="route-list">
              {routes.map((route, index) => {
                const provider = providerMap[route.provider];
                const selectedModel = provider?.models.find((model) => model.id === route.model);
                const capabilities = selectedModel?.capabilities;
                const capabilitySummary = capabilities
                  ? `${capabilities.referenceImages ? `Up to ${capabilities.maxReferenceImages} reference image${capabilities.maxReferenceImages === 1 ? "" : "s"}` : "Text-to-image only"} · ${capabilities.aspectRatios.length} aspect ratios`
                  : "Capabilities unknown";
                return (
                  <div className="route-row" key={route.provider}>
                    <span className="route-row__index">{String(index + 1).padStart(2, "0")}</span>
                    <div className="route-row__provider"><img src={MARKS[route.provider]} width="28" height="28" alt="" /><div><strong>{provider?.name || route.provider}</strong><div>{!route.enabled ? <StatusPill>Disabled</StatusPill> : index === defaultIndex ? <StatusPill tone="healthy">Default</StatusPill> : <StatusPill>Fallback</StatusPill>}</div></div></div>
                    <div className="route-row__controls">
                      <div className="field"><label htmlFor={`model-${route.provider}`}>Image model</label><select className="select machine" id={`model-${route.provider}`} value={route.model} onChange={(event) => update(index, { model: event.target.value })}>{provider?.models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select><span className="field__helper">{capabilitySummary}</span></div>
                      <label className="toggle"><input type="checkbox" checked={route.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} /><span>Enabled</span></label>
                    </div>
                    <div className="route-row__actions"><button className="button button--quiet icon-button" type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${route.provider} up`}><ArrowUp aria-hidden="true" /></button><button className="button button--quiet icon-button" type="button" disabled={index === routes.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${route.provider} down`}><ArrowDown aria-hidden="true" /></button></div>
                  </div>
                );
              })}
            </div>
          </section>
          <Notice tone="warning"><p>Codex and Antigravity remain Experimental. Keep xAI first if you want the most stable default.</p></Notice>
        </>
      )}
    </>
  );
}
