import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "tournament", end: true },
  { to: "/receipts", label: "receipts", end: false },
  { to: "/policy", label: "policy", end: false },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-8 gap-y-2 px-6 py-4">
          <span className="text-sm font-semibold tracking-[0.2em] text-accent">VAULT-PILOT</span>
          <nav className="flex gap-6 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? "text-ink" : "text-muted hover:text-ink transition-colors"
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto text-xs text-muted">
            notional capital · live yields · real timestamps
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-edge bg-panel ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-xs uppercase tracking-[0.18em] text-muted">{children}</h2>
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
    <Panel className="border-bad/40 p-4 text-sm">
      <p className="text-bad">Could not load data.</p>
      <p className="mt-2 text-muted">{error}</p>
      <p className="mt-3 text-muted">
        Is the read API running? Start it with <code className="text-ink">pnpm api</code>.
      </p>
    </Panel>
  );
}
