import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Panel, SectionTitle, Empty, ErrorNote } from "../components/shell";
import { pct } from "../lib/format";

export function PolicyPage() {
  const { data, error } = useApi(() => api.policy());

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Empty>Loading policy…</Empty>;

  return (
    <div className="space-y-10">
      <section>
        <SectionTitle hint={`version ${data.policy_version}`}>Allocation policy</SectionTitle>
        <Panel className="divide-y divide-edge">
          <div className="flex items-baseline justify-between gap-4 p-4">
            <div>
              <div className="text-sm font-medium text-ink">Maximum per vault</div>
              <div className="text-xs leading-5 text-muted">
                No single vault may hold more than this share of equity.
              </div>
            </div>
            <span className="tabular text-lg font-semibold text-ink">
              {pct(data.max_allocation_per_vault, 0)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 p-4">
            <div>
              <div className="text-sm font-medium text-ink">Gross cap</div>
              <div className="text-xs leading-5 text-muted">
                Total invested share; 1.0 means fully invested with no leverage.
              </div>
            </div>
            <span className="tabular text-lg font-semibold text-ink">
              {data.gross_cap.toFixed(2)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 p-4">
            <div>
              <div className="text-sm font-medium text-ink">Minimum rebalance spread</div>
              <div className="text-xs leading-5 text-muted">
                Below this, a move is churn and is not worth making.
              </div>
            </div>
            <span className="tabular text-lg font-semibold text-ink">
              {data.min_rebalance_spread_bps}bps
            </span>
          </div>
        </Panel>
        <p className="mt-3 text-xs leading-6 text-muted">
          These constraints are enforced twice: once as instructions to the model, and again by a
          deterministic guard chain that runs after every decision. A model cannot talk its way
          past the second one — any violation holds the previous allocation and is recorded in the
          receipt.
        </p>
      </section>

      <section>
        <SectionTitle hint={`${data.vaults.length} vaults`}>Pinned vault set</SectionTitle>
        <Panel className="divide-y divide-edge">
          {data.vaults.map((vault) => (
            <div key={vault.vaultId} className="flex flex-wrap items-baseline gap-x-4 p-4">
              <span className="text-sm font-medium text-ink">{vault.vaultId}</span>
              <span className="text-xs text-muted">{vault.label}</span>
              <span className="chip ml-auto">{vault.assetClass}</span>
            </div>
          ))}
        </Panel>
      </section>

      <section>
        <SectionTitle hint={`${data.arms.length} arms`}>Tournament arms</SectionTitle>
        <Panel className="divide-y divide-edge">
          {data.arms.map((arm) => (
            <div key={arm.id} className="flex flex-wrap items-baseline gap-x-4 p-4">
              <span className="text-sm font-medium text-ink">{arm.id}</span>
              <span className="text-xs text-muted">{arm.model}</span>
              {arm.shadow_agent ? (
                <span className="chip chip-accent ml-auto">shadow agent</span>
              ) : null}
            </div>
          ))}
        </Panel>
        <p className="mt-3 text-xs leading-6 text-muted">
          Every arm sees an identical yield snapshot each epoch, so differences in outcome are
          attributable to reasoning rather than to data. The shadow arm runs the same model as its
          base counterpart with an extra validation loop, isolating what that loop contributes.
        </p>
      </section>
    </div>
  );
}
