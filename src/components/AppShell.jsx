"use client";

import {
  Activity,
  Cable,
  Gauge,
  Image as ImageIcon,
  Library,
  Route,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAVIGATION = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/providers", label: "Providers", icon: Cable },
  { href: "/routing", label: "Routing", icon: Route },
  { href: "/playground", label: "Playground", icon: ImageIcon },
  { href: "/prompts", label: "Prompts", icon: Library },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ImageRouter overview">
      <img className="brand__mark" src="/imagerouter-mark.svg" width="28" height="28" alt="" />
      <span className="brand__name">ImageRouter</span>
    </Link>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <header className="mobile-head">
        <Brand />
        <span className="mobile-head__note">LOCAL</span>
      </header>
      <aside className="rail" aria-label="Primary navigation">
        <Brand />
        <nav className="rail__nav">
          {NAVIGATION.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} className="rail__link" href={href} aria-current={active ? "page" : undefined} title={label}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="rail__runtime" title="Bound to localhost">
          <span className="rail__runtime-dot" aria-hidden="true" />
          <span className="sr-only">Local runtime</span>
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
