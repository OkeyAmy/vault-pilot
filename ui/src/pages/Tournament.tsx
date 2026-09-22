import { useCallback, useState } from "react";
import { api, type LeaderboardRow, type VaultYield } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Panel, SectionTitle, Empty, ErrorNote } from "../components/shell";
import { RunPanel } from "../components/RunPanel";
import { apy, usd, signedBps, costUsd, pct, timeAgo } from "../lib/format";

function YieldStrip({ yields }: { yields: VaultYield[] }) {
  const best = Math.max(...yields.map((y) => y.apyBps));
  const worst = Math.min(...yields.map((y) => y.apyBps));

  return (
    <>
      <SectionTitle hint={yields[0] ? `updated ${timeAgo(yields[0].observedAt)}` : undefined}>
        Live vault yields
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {yields.map((y) => (
          <Panel key={y.vaultId} className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                {y.vaultId}
              </span>
              {y.apyBps === best ? (
                <span className="chip chip-accent">best</span>
              ) : null}
            </div>
            <div className="tabular mt-2 text-2xl font-semibold text-ink">{apy(y.apyBps)}</div>
            <div className="mt-1 text-xs text-muted">tvl {usd(y.tvlUsd)}</div>
          </Panel>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Spread between best and worst vault:{" "}
        <span className="tabular text-ink">{(best - worst).toFixed(0)}bps</span>. A rebalance is
        only permitted when it clears the policy threshold.
      </p>
    </>
  );
}

function StandingsTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="table-grid min-w-[720px]">
        <thead>
          <tr>
            <th>arm</th>
            <th>model</th>
            <th className="text-right">epochs</th>
            <th className="text-right">rebalances</th>
            <th className="text-right">cumulative Δ</th>
            <th className="text-right">cost/decision</th>
            <th className="text-right">compliance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.model_id}>
              <td>
                <span className="text-muted">{index + 1}.</span>{" "}
                <span className="font-medium text-ink">{row.model_id}</span>
                {row.shadow_agent ? <span className="chip chip-accent ml-2">shadow</span> : null}
              </td>
              <td className="text-muted">{row.reasoning_model}</td>
              <td className="tabular text-right">{row.epochs}</td>
              <td className="tabular text-right">{row.rebalances}</td>
              <td
                className={`tabular text-right font-medium ${
                  row.cumulative_yield_delta_bps >= 0 ? "text-good" : "text-bad"
                }`}
              >
                {signedBps(row.cumulative_yield_delta_bps)}
              </td>
              <td className="tabular text-right text-muted">
                {costUsd(row.cost_per_decision_usd)}
              </td>
              <td
                className={`tabular text-right ${
                  row.guard_failures > 0 ? "text-warn" : "text-muted"
                }`}
              >
                {row.policy_compliance_pct.toFixed(0)}%
                {row.guard_failures > 0 ? ` (${row.guard_failures} held)` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function Tournament() {
  // Bumped when a run finishes so yields and standings refetch immediately
  // rather than waiting out their poll interval.
  const [refreshKey, setRefreshKey] = useState(0);
  const onRunComplete = useCallback(() => setRefreshKey((k) => k + 1), []);

  const yields = useApi(() => api.yields(), 60_000, [refreshKey]);
  const board = useApi(() => api.leaderboard(), 30_000, [refreshKey]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-bold uppercase tracking-[0.14em] text-ink md:text-2xl">
          Autonomous RWA treasury autopilot
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          Each epoch, every arm reasons over the same live yield snapshot under the same policy.
          A deterministic guard chain re-checks the result before it is recorded, and each receipt
          hash is published onchain so the decision provably predates its outcome.{" "}
          <span className="font-medium text-ink">The capital is notional.</span> The yields, the
          reasoning, the policy enforcement and the timestamps are real.
        </p>
      </section>

      <section>
        <RunPanel onRunComplete={onRunComplete} />
      </section>

      <section>
        {yields.error && !yields.data ? (
          <ErrorNote error={yields.error} />
        ) : yields.data ? (
          <YieldStrip yields={yields.data} />
        ) : (
          <Empty>Loading live yields…</Empty>
        )}
      </section>

      <section>
        <SectionTitle hint="ranked by cumulative yield delta">Tournament standings</SectionTitle>
        {board.error && !board.data ? (
          <ErrorNote error={board.error} />
        ) : board.data && board.data.length > 0 ? (
          <>
            <StandingsTable rows={board.data} />
            <p className="mt-3 text-xs text-muted">
              Mean confidence{" "}
              <span className="tabular text-ink">
                {pct(
                  board.data.reduce((s, r) => s + r.mean_confidence, 0) / board.data.length,
                  0,
                )}
              </span>{" "}
              across {board.data.reduce((s, r) => s + r.epochs, 0)} recorded decisions.
            </p>
          </>
        ) : (
          <Empty>
            No epochs recorded yet. Run <span className="text-ink">pnpm epoch</span> to produce the
            first set of receipts.
          </Empty>
        )}
      </section>
    </div>
  );
}
