import { useCallback, useState, type CSSProperties } from "react";
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

/**
 * Per-epoch yield deltas as midline tiles: fill grows up for a gain, down
 * for a loss, scaled against the largest move in the window so a flat tape
 * still reads. The same shape as every epoch is a different story.
 */
function EpochTape({ deltas, latestEpoch }: { deltas: number[]; latestEpoch: number }) {
  if (deltas.length === 0) return null;
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d)), 1e-9);
  const firstEpoch = latestEpoch - deltas.length + 1;

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
        epoch tape
      </div>
      <div className="tape-grid">
        {deltas.map((delta, i) => {
          const tone = Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";
          const fillH = `${Math.max(6, Math.min(100, (Math.abs(delta) / maxAbs) * 100))}%`;
          return (
            <div key={i} className={`tape-tile ${tone}`}>
              <div className="tape-label">
                <em>E{String(firstEpoch + i).padStart(3, "0")}</em>
                <strong>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </strong>
              </div>
              <div className="tape-midline" />
              {tone !== "flat" ? (
                <div className={`tape-fill ${tone}`} style={{ "--fill-h": fillH } as CSSProperties} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ArmDossier — the selected arm filed below the ledger: identity header,
 * wide reasoning column, stats + epoch tape alongside. Full width so the
 * why-text reads like a page, not a squeezed table cell or a skinny tower.
 */
function ArmDossier({ row, rank, order }: {
  row: LeaderboardRow;
  rank: number;
  order: string[];
}) {
  const deltas = row.recent_yield_deltas_bps ?? [];
  const position = Object.entries(row.current_allocation ?? {})
    .filter(([, fraction]) => fraction > 0.0005)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="dossier">
      <div className="dossier-head">
        <span className="dossier-rank">#{String(rank).padStart(3, "0")}</span>
        <strong>{row.model_id}</strong>
        {row.shadow_agent ? <span className="chip chip-accent">shadow</span> : null}
        <span className="dossier-meta">
          {row.reasoning_model?.split("/").pop()} · last decision{" "}
          {row.last_epoch_at ? timeAgo(row.last_epoch_at) : "—"} · {row.receipts_anchored}/
          {row.epochs} receipts anchored
        </span>
        <span className="dossier-tag">arm dossier</span>
      </div>

      <div className="dossier-body">
        <div className="dossier-col-main">
          <div className="why-card">
            <div className="why-head">
              <strong>why</strong>
              <span>
                epoch {String(row.latest_epoch ?? 1).padStart(3, "0")} ·{" "}
                {row.last_epoch_at ? timeAgo(row.last_epoch_at) : ""}
              </span>
            </div>
            <p>{row.latest_rationale || "No reasoning recorded for this arm yet."}</p>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              current position
            </div>
            <AllocationBar allocation={row.current_allocation ?? {}} order={order} height="h-3" />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {position.length === 0 ? (
                <span className="text-xs text-muted">all cash</span>
              ) : (
                position.map(([vaultId, fraction]) => (
                  <span key={vaultId} className="text-xs">
                    <span className="text-muted">{vaultId}</span>{" "}
                    <span className="tabular font-medium text-ink">{pct(fraction, 1)}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="dossier-col-side">
          <div className="stat-tile-grid">
            <div className="stat-tile">
              <span>cumulative Δ</span>
              <strong className={row.cumulative_yield_delta_bps >= 0 ? "text-good" : "text-bad"}>
                {signedBps(row.cumulative_yield_delta_bps)}
              </strong>
            </div>
            <div className="stat-tile">
              <span>current yield</span>
              <strong>{apy(row.current_yield_bps)}</strong>
            </div>
            <div className="stat-tile">
              <span>cost / decision</span>
              <strong>${row.cost_per_decision_usd.toFixed(4)}</strong>
            </div>
            <div className="stat-tile">
              <span>compliance</span>
              <strong className={row.guard_failures > 0 ? "text-warn" : undefined}>
                {row.policy_compliance_pct.toFixed(0)}%
              </strong>
            </div>
            <div className="stat-tile">
              <span>confidence</span>
              <strong>{pct(row.mean_confidence, 0)}</strong>
            </div>
            <div className="stat-tile">
              <span>risk</span>
              <strong>{pct(row.mean_risk_score, 0)}</strong>
            </div>
          </div>

          <EpochTape deltas={deltas} latestEpoch={row.latest_epoch ?? 0} />
        </div>
      </div>

      <div className="dossier-rules arm-rules">
        <span>ranked by cumulative yield delta</span>
        <span>every arm sees the same yield snapshot per epoch</span>
        <span>the guard chain is authoritative — overrides hold the previous allocation</span>
      </div>
    </section>
  );
}

function StandingsTable({ rows }: { rows: LeaderboardRow[] }) {
  const order = allocationOrder(rows.map((r) => r.current_allocation ?? {}));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to rank 1, keep the selection across refreshes when it still exists.
  const selected = rows.find((r) => r.model_id === selectedId) ?? rows[0] ?? null;
  const selectedRank = selected ? rows.indexOf(selected) + 1 : 0;

  return (
    <div className="min-w-0">
      <div className="standings-shell">
        <div className="standings-grid">
          <div className="sg-row sg-head">
            <span>rank</span>
            <span>arm</span>
            <span>model</span>
            <span>current position</span>
            <span className="sg-num">epochs</span>
            <span className="sg-num">cumulative Δ</span>
            <span className="sg-num">risk</span>
            <span className="sg-num">compliance</span>
          </div>
          {rows.map((row, index) => {
            const rank = index + 1;
            const medal = rank <= 3 ? `medal-${rank}` : "";
            const isSelected = selected?.model_id === row.model_id;
            return (
              <div
                key={row.model_id}
                className={`sg-row ${medal} ${isSelected ? "is-selected" : ""}`}
                onClick={() => setSelectedId(row.model_id)}
                title="Inspect this arm"
              >
                <span className="sg-rank">#{String(rank).padStart(3, "0")}</span>
                <span className="font-medium text-ink">
                  {row.model_id}
                  {row.shadow_agent ? <span className="chip chip-accent ml-2">shadow</span> : null}
                </span>
                <span className="truncate text-muted">
                  {row.reasoning_model?.split("/").pop()}
                </span>
                <span>
                  <AllocationBar allocation={row.current_allocation ?? {}} order={order} />
                </span>
                <span className="sg-num text-muted">{row.epochs}</span>
                <span
                  className={`sg-num font-medium ${
                    row.cumulative_yield_delta_bps >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {signedBps(row.cumulative_yield_delta_bps)}
                </span>
                <span className="sg-num text-muted">{pct(row.mean_risk_score ?? 0, 0)}</span>
                <span
                  className={`sg-num ${row.guard_failures > 0 ? "text-warn" : "text-muted"}`}
                >
                  {row.policy_compliance_pct.toFixed(0)}%
                  {row.guard_failures > 0 ? ` (${row.guard_failures} held)` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <AllocationLegend order={order} />
        <span className="text-[11px] text-muted">click a row to file its dossier below</span>
      </div>

      {selected ? (
        <ArmDossier key={selected.model_id} row={selected} rank={selectedRank} order={order} />
      ) : (
        <section className="dossier">
          <div className="dossier-head">
            <strong>arm dossier</strong>
            <span className="dossier-meta">No arms recorded yet.</span>
          </div>
        </section>
      )}
    </div>
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
