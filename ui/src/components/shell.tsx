import { NavLink, Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "home", end: true },
  { to: "/tournament", label: "tournament", end: true },
  { to: "/receipts", label: "receipts", end: false },
  { to: "/policy", label: "policy", end: false },
];

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-rule bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3">
          <Link to="/" className="flex items-center gap-3">
            <svg viewBox="0 0 64 64" className="h-7 w-7 shrink-0" aria-hidden="true">
              <path
                d="M14 8 H50 V48 l-6 4 l-6 -4 l-6 4 l-6 -4 l-6 4 l-6 -4 Z"
                fill="#f7f6f2"
                stroke="#141414"
                strokeWidth="3"
              />
              <rect x="14" y="8" width="36" height="11" fill="#141414" />
              <rect x="20" y="28" width="17" height="7" fill="#3b66d9" />
              <rect x="20" y="39" width="11" height="3" fill="#141414" />
              <circle cx="47" cy="47" r="9" fill="#3b66d9" stroke="#f7f6f2" strokeWidth="2.5" />
            </svg>
            <span className="grid gap-1">
              <span className="text-base font-bold leading-none tracking-[0.2em] text-ink">
                VAULT-PILOT
              </span>
              <span className="text-[9px] uppercase leading-none tracking-[0.3em] text-muted">
                autonomous rwa treasury autopilot
              </span>
            </span>
          </Link>
          <nav className="flex items-center">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `border-r border-edge px-4 py-1 text-sm last:border-r-0 ${
                    isActive
                      ? "text-ink underline decoration-accent decoration-2 underline-offset-4"
                      : "text-muted transition-colors hover:text-ink"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto hidden text-xs text-muted lg:inline">
            notional capital · live yields · real timestamps
          </span>
        </div>
      </header>
      <main className={isHome ? "" : "mx-auto max-w-6xl px-6 py-8"}>{children}</main>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-edge bg-panel ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-rule pb-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink">{children}</h2>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Panel className="p-8 text-center text-sm text-muted">
      <p>{children}</p>
    </Panel>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <Panel className="p-4 text-sm">
      <p className="font-semibold text-bad">Could not load data.</p>
      <p className="mt-2 text-muted">{error}</p>
      <p className="mt-3 text-muted">
        Is the read API running? Start everything with{" "}
        <code className="text-ink">pnpm dev</code>.
      </p>
    </Panel>
  );
}
