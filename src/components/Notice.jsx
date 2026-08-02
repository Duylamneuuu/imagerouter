import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export function Notice({ children, tone = "neutral" }) {
  const Icon = tone === "warning" || tone === "error" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return <div className="notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}><Icon aria-hidden="true" /><div>{children}</div></div>;
}
