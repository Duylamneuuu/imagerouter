export function StatusPill({ children, tone = "neutral" }) {
  return <span className="status-pill" data-tone={tone}>{children}</span>;
}
