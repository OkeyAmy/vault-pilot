import { Fragment, useCallback, useState } from "react";
import { api, type LeaderboardRow, type VaultYield } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Panel, SectionTitle, Empty, ErrorNote } from "../components/shell";
import { RunPanel } from "../components/RunPanel";
import { AllocationBar, AllocationLegend, allocationOrder } from "../components/AllocationBar";
import { apy, usd, signedBps, pct, timeAgo } from "../lib/format";

function YieldStrip({ yields }: { yields: VaultYield[] }) {
  // A vault without enough history has no yield — not a yield of zero.
  // Including it in best/worst would invent a spread that does not exist.
  const known = yields.filter((y) => y.apyKnown !== false);
  const best = known.length > 0 ? Math.max(...known.map((y) => y.apyBps)) : null;
  const worst = known.length > 0 ? Math.min(...known.map((y) => y.apyBps)) : null;
  const unknownCount = yields.length - known.length;

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
              {y.apyKnown === false ? (
                <span className="chip">unproven</span>
              ) : y.apyBps === best ? (
                <span className="chip chip-accent">best</span>
              ) : null}
            </div>
            {y.apyKnown === false ? (
              <>
                <div className="tabular mt-2 text-2xl font-semibold text-muted">—</div>
                <div className="mt-1 text-xs text-muted">no yield history yet</div>
              </>
            ) : (
              <div className="tabular mt-2 text-2xl font-semibold text-ink">{apy(y.apyBps)}</div>
            )}
            <div className="mt-1 text-xs text-muted">tvl {usd(y.tvlUsd)}</div>
          </Panel>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {best !== null && worst !== null ? (
          <>
            Spread across vaults with observed yield:{" "}
            <span className="tabular text-ink">{(best - worst).toFixed(0)}bps</span>. A rebalance is
            only permitted when it clears the policy threshold.
          </>
        ) : (
          <>No vault has enough yield history to compare yet.</>
        )}
        {unknownCount > 0 ? (
          <>
            {" "}
            <span className="tabular text-ink">{unknownCount}</span>{" "}
            {unknownCount === 1 ? "vault reports" : "vaults report"} no yield yet, shown as
            unknown rather than zero — deciding what to do with that is part of the task.
          </>
        ) : null}
      </p>
    </>
  );
}

function StandingsTable({ rows }: { rows: LeaderboardRow[] }) {
  const order = allocationOrder(rows.map((r) => r.current_allocation ?? {}));
  const [openArm, setOpenArm] = useState<string | null>(null);

  return (
    <>
      <Panel className="overflow-x-auto">
        <table className="table-grid min-w-[860px]">
          <thead>
            <tr>
              <th>arm</th>
              <th>model</th>
              <th className="w-[26%]">current position</th>
              <th className="text-right">epochs</th>
              <th className="text-right">cumulative Δ</th>
              <th className="text-right">risk</th>
              <th className="text-right">compliance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <Fragment key={row.model_id}>
                <tr
                  onClick={() => setOpenArm(openArm === row.model_id ? null : row.model_id)}
                  className="cursor-pointer"
                  title="Show this arm's reasoning"
                >
                  <td>
                    <span className="text-muted">{index + 1}.</span>{" "}
                    <span className="font-medium text-ink">{row.model_id}</span>
                    {row.shadow_agent ? <span className="chip chip-accent ml-2">shadow</span> : null}
                  </td>
                  <td className="text-muted">{row.reasoning_model?.split("/").pop()}</td>
                  <td>
                    <AllocationBar allocation={row.current_allocation ?? {}} order={order} />
                  </td>
                  <td className="tabular text-right">{row.epochs}</td>
                  <td
                    className={`tabular text-right font-medium ${
                      row.cumulative_yield_delta_bps >= 0 ? "text-good" : "text-bad"
                    }`}
                  >
                    {signedBps(row.cumulative_yield_delta_bps)}
                  </td>
                  <td className="tabular text-right text-muted">
                    {pct(row.mean_risk_score ?? 0, 0)}
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
                {openArm === row.model_id && row.latest_rationale ? (
                  <tr>
                    <td colSpan={7} className="bg-paper">
                      <p className="max-w-3xl text-xs leading-6 text-muted">
                        <span className="font-semibold uppercase tracking-[0.16em] text-ink">
                          why{" "}
                        </span>
                        {row.latest_rationale}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <AllocationLegend order={order} />
        <span className="text-[11px] text-muted">click a row to read its reasoning</span>
      </div>
    </>
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
