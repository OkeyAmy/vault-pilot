import { useEffect, useState } from "react";
import type { RunState } from "../lib/api";

function countdown(toIso: string, now: number): string {
  const seconds = Math.max(0, Math.round((new Date(toIso).getTime() - now) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Proof of life between epochs. Without it the interface looks dormant for
 * the whole interval, which reads as broken rather than scheduled.
 */
export function Heartbeat({ run }: { run: RunState | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const running = run?.phase === "running";
  const schedulerOn = run?.schedulerOn !== false;

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${
          running ? "animate-pulse bg-accent" : schedulerOn ? "bg-good" : "bg-muted"
        }`}
      />
      {running ? (
        <span className="text-accent">deciding now…</span>
      ) : !schedulerOn ? (
        <span className="text-muted">scheduler off</span>
      ) : run?.nextRunAt ? (
        <span className="text-muted">
          next decision in <span className="tabular text-ink">{countdown(run.nextRunAt, now)}</span>
        </span>
      ) : (
        <span className="text-muted">scheduled</span>
      )}
    </span>
  );
}
