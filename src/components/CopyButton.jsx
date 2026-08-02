"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CopyButton({ value, compact = true }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    setState("loading");
    try {
      await navigator.clipboard.writeText(value);
      setState("success");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button className={`button copy-button${compact ? " button--compact" : ""}`} type="button" onClick={copy} disabled={state === "loading"} data-state={state}>
      {state === "success" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {state === "loading" ? "Copying…" : state === "success" ? "Copied" : state === "error" ? "Copy failed" : "Copy"}
    </button>
  );
}
