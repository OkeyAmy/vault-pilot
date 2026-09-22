import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Preflight, type RunState } from "../lib/api";
import { Panel } from "./shell";
import { Heartbeat } from "./Heartbeat";

const LEVEL_COLOR = {
  info: "text-muted",
  ok: "text-good",
  warn: "text-warn",
  error: "text-bad",
} as const;

function Readiness({ preflight }: { preflight: Preflight }) {
  return (
    <div className="mt-3 space-y-1.5 text-xs">
      {preflight.blockers.map((blocker) => (
        <p key={blocker} className="text-bad">
          ✕ {blocker}
        </p>
      ))}
      {preflight.warnings.map((warning) => (
        <p key={warning} className="text-warn">
          ! {warning}
        </p>
      ))}
      <p className="text-muted">
        endpoint <span className="text-ink">{preflight.reasoning.baseUrl}</span>
        {preflight.reasoning.servToolsActive ? (
          <span className="text-good"> · serv tools active</span>
        ) : (
          <span> · serv tools inactive for this endpoint</span>
        )}
        {" · "}
        {preflight.reasoning.arms.length} arms
      </p>
    </div>
  );
}

export function RunPanel({ onRunComplete }: { onRunComplete: () => void }) {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastGeneration = useRef<number | null>(null);

  const refreshPreflight = useCallback(() => {
    api
      .preflight()
      .then(setPreflight)
      .catch(() => setPreflight(null));
  }, []);

  useEffect(refreshPreflight, [refreshPreflight]);

  // Poll quickly while a run is in flight, slowly otherwise.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const state = await api.runStatus();
        if (cancelled) return;
        setRun(state);
        if (lastGeneration.current === null) {
          lastGeneration.current = state.generation;
        } else if (state.generation !== lastGeneration.current) {
          lastGeneration.current = state.generation;
          onRunComplete();
          refreshPreflight();
        }
      } catch {
        // The API may be restarting; the next tick will pick it back up.
      }
    };
    void tick();
    const interval = setInterval(tick, run?.phase === "running" ? 1000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [run?.phase, onRunComplete, refreshPreflight]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run?.steps.length]);

  const running = run?.phase === "running";
  const blocked = preflight ? !preflight.ready : false;

  const start = async () => {
    setStartError(null);
    setStarting(true);
    try {
      await api.startEpoch();
      setRun((prev) => (prev ? { ...prev, phase: "running", steps: [] } : prev));
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void start()}
          disabled={running || starting || blocked}
          className="btn"
        >
          {running ? "running epoch…" : starting ? "starting…" : "run epoch"}
        </button>

        <span className="text-xs text-muted">
          {running
            ? "Every arm is reasoning over the same live snapshot."
            : blocked
              ? "Not ready to run — see below."
              : "Fetches live yields, requests a decision per arm, writes signed receipts."}
        </span>

        <span className="ml-auto flex items-center gap-4">
          <Heartbeat run={run} />
        </span>

        {run?.phase === "done" ? (
          <span className="ml-auto text-xs font-medium text-good">last run completed</span>
        ) : run?.phase === "error" ? (
          <span className="ml-auto text-xs font-medium text-bad">last run failed</span>
        ) : null}
      </div>

      {startError ? <p className="mt-3 text-xs text-bad">{startError}</p> : null}
      {preflight ? <Readiness preflight={preflight} /> : null}

      {run && run.steps.length > 0 ? (
        <div ref={logRef} className="log-console mt-3 max-h-56 overflow-y-auto p-3 text-xs">
          {run.steps.map((step, i) => (
            <div key={i} className="flex gap-2 py-0.5 leading-relaxed">
              <span className="shrink-0 text-muted">
                {new Date(step.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {step.arm ? <span className="shrink-0 font-semibold text-ink">[{step.arm}]</span> : null}
              <span className={LEVEL_COLOR[step.level]}>{step.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {run?.error ? <p className="mt-3 text-xs text-bad">{run.error}</p> : null}
    </Panel>
  );
}
