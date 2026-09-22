import { useState } from "react";
import { api, type Receipt } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Panel, SectionTitle, Empty, ErrorNote } from "../components/shell";
import { signedBps, apy, costUsd, pct, shortHash, timeAgo } from "../lib/format";

function AllocationBar({ allocation }: { allocation: Record<string, number> }) {
  const entries = Object.entries(allocation).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-xs text-muted">all cash</span>;

  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded bg-edge">
        {entries.map(([vaultId, fraction], i) => (
          <div
            key={vaultId}
            title={`${vaultId} ${pct(fraction)}`}
            style={{
              width: `${fraction * 100}%`,
              // Stepped opacity keeps segments distinguishable without
              // introducing a second hue that would compete with the accent.
              opacity: 1 - i * 0.18,
            }}
            className="bg-accent"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted">
        {entries.map(([vaultId, fraction]) => (
          <span key={vaultId}>
            {vaultId} <span className="tabular text-ink">{pct(fraction, 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const [open, setOpen] = useState(false);

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm text-ink">epoch {receipt.epoch}</span>
        <span className="text-xs text-muted">{receipt.model}</span>
        <span
          className={`tabular text-sm ${
            receipt.yield_delta_bps > 0
              ? "text-accent"
              : receipt.yield_delta_bps < 0
                ? "text-bad"
                : "text-muted"
          }`}
        >
          {signedBps(receipt.yield_delta_bps, 2)}
        </span>
        {!receipt.policy_checks_passed ? (
          <span className="rounded border border-warn/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">
            guards held allocation
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted">{timeAgo(receipt.timestamp)}</span>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">before</div>
          <AllocationBar allocation={receipt.pre_allocation} />
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">after</div>
          <AllocationBar allocation={receipt.post_allocation} />
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{receipt.rationale}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          confidence <span className="tabular text-ink">{pct(receipt.confidence, 0)}</span>
        </span>
        <span>
          risk <span className="tabular text-ink">{pct(receipt.risk_score, 0)}</span>
        </span>
        <span>
          cost <span className="tabular text-ink">{costUsd(receipt.reasoning_cost_usd)}</span>
        </span>
        <span>
          settlement <span className="text-ink">{receipt.settlement_mode}</span>
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-muted underline decoration-edge underline-offset-4 hover:text-ink"
        >
          {open ? "hide proof" : "show proof"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-edge pt-3 text-xs">
          <div>
            <span className="text-muted">receipt hash </span>
            <span className="tabular break-all text-ink">{receipt.receipt_hash}</span>
          </div>
          {receipt.anchor ? (
            <>
              <div>
                <span className="text-muted">anchored in block </span>
                <span className="tabular text-ink">{receipt.anchor.block_number}</span>
                <span className="text-muted"> on chain </span>
                <span className="tabular text-ink">{receipt.anchor.chain_id}</span>
              </div>
              <a
                href={receipt.anchor.explorer_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block text-accent underline decoration-accent/40 underline-offset-4"
              >
                verify onchain: {shortHash(receipt.anchor.tx_hash, 14)} ↗
              </a>
              <p className="text-muted">
                The transaction calldata is this receipt hash, so the decision provably existed at
                that block&apos;s timestamp.
              </p>
            </>
          ) : (
            <p className="text-warn">
              Not anchored onchain. Set ANCHOR_PRIVATE_KEY and fund the address to publish hashes.
            </p>
          )}
          {receipt.policy_violations.length > 0 ? (
            <div>
              <span className="text-muted">violations: </span>
              <span className="text-warn">{receipt.policy_violations.join("; ")}</span>
            </div>
          ) : null}
          <div className="text-muted">
            observed yields:{" "}
            {Object.entries(receipt.observed_yields_bps)
              .map(([v, b]) => `${v} ${apy(b)}`)
              .join(" · ")}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

export function Receipts() {
  const { data, error } = useApi(() => api.receipts(), 30_000);
  const [arm, setArm] = useState<string>("all");

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Empty>Loading receipts…</Empty>;

  const arms = Object.keys(data);
  const all = Object.values(data)
    .flat()
    .sort((a, b) => b.epoch - a.epoch || a.model.localeCompare(b.model));
  const shown = arm === "all" ? all : (data[arm] ?? []).slice().sort((a, b) => b.epoch - a.epoch);

  if (all.length === 0) {
    return (
      <Empty>
        No receipts yet. Run <span className="text-ink">pnpm epoch</span> to produce the first one.
      </Empty>
    );
  }

  const anchored = all.filter((r) => r.anchor).length;

  return (
    <div>
      <SectionTitle hint={`${anchored} of ${all.length} anchored onchain`}>
        Receipt log
      </SectionTitle>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {["all", ...arms].map((id) => (
          <button
            key={id}
            onClick={() => setArm(id)}
            className={`rounded border px-2.5 py-1 transition-colors ${
              arm === id
                ? "border-accent/50 text-accent"
                : "border-edge text-muted hover:text-ink"
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((receipt) => (
          <ReceiptCard key={`${receipt.model}-${receipt.epoch}`} receipt={receipt} />
        ))}
      </div>

      <p className="mt-6 text-xs text-muted">
        Every receipt above can be re-verified offline and against the chain with{" "}
        <span className="text-ink">python3 scripts/verify.py --all --rpc</span>.
      </p>
    </div>
  );
}
