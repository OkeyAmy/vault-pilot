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
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink">{y.vaultId}</span>
              {y.apyBps === best ? (
                <span className="text-[10px] uppercase tracking-wider text-accent">best</span>
              ) : null}
            </div>
            <div className="tabular mt-2 text-2xl text-ink">{apy(y.apyBps)}</div>
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
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-normal">arm</th>
            <th className="px-4 py-3 font-normal">model</th>
            <th className="px-4 py-3 text-right font-normal">epochs</th>
            <th className="px-4 py-3 text-right font-normal">rebalances</th>
            <th className="px-4 py-3 text-right font-normal">cumulative Δ</th>
            <th className="px-4 py-3 text-right font-normal">cost/decision</th>
            <th className="px-4 py-3 text-right font-normal">compliance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.model_id} className="border-b border-edge/50 last:border-0">
              <td className="px-4 py-3">
                <span className="text-muted">{index + 1}.</span>{" "}
                <span className="text-ink">{row.model_id}</span>
                {row.shadow_agent ? (
                  <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                    shadow
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-muted">{row.reasoning_model}</td>
              <td className="tabular px-4 py-3 text-right">{row.epochs}</td>
              <td className="tabular px-4 py-3 text-right">{row.rebalances}</td>
              <td
                className={`tabular px-4 py-3 text-right ${
                  row.cumulative_yield_delta_bps >= 0 ? "text-accent" : "text-bad"
                }`}
              >
                {signedBps(row.cumulative_yield_delta_bps)}
              </td>
              <td className="tabular px-4 py-3 text-right text-muted">
                {costUsd(row.cost_per_decision_usd)}
              </td>
              <td
                className={`tabular px-4 py-3 text-right ${
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
        <h1 className="text-lg text-ink">Autonomous RWA treasury autopilot</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Each epoch, every arm reasons over the same live yield snapshot under the same policy.
          A deterministic guard chain re-checks the result before it is recorded, and each receipt
          hash is published onchain so the decision provably predates its outcome.{" "}
          <span className="text-ink">The capital is notional.</span> The yields, the reasoning, the
          policy enforcement and the timestamps are real.
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
