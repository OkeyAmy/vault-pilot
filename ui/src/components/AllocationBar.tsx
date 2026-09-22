import { pct } from "../lib/format";

/**
 * Stable vault order and shade, so the same vault occupies the same visual
 * slot in every bar. Without that, comparing two arms means reading legends
 * instead of seeing the difference.
 */
export function allocationOrder(allocations: Record<string, number>[]): string[] {
  const seen = new Set<string>();
  for (const allocation of allocations) {
    for (const vaultId of Object.keys(allocation)) seen.add(vaultId);
  }
  return [...seen].sort();
}

/** Stepped opacity keeps segments distinct without a second competing hue. */
function shade(index: number, total: number): number {
  if (total <= 1) return 1;
  return 1 - (index / (total - 1)) * 0.62;
}

export function AllocationBar({
  allocation,
  order,
  height = "h-2",
}: {
  allocation: Record<string, number>;
  order: string[];
  height?: string;
}) {
  const segments = order
    .map((vaultId, index) => ({
      vaultId,
      fraction: allocation[vaultId] ?? 0,
      opacity: shade(index, order.length),
    }))
    .filter((s) => s.fraction > 0.0005);

  const invested = segments.reduce((sum, s) => sum + s.fraction, 0);

  if (segments.length === 0) {
    return <span className="text-[11px] text-muted">all cash</span>;
  }

  return (
    <div className={`flex ${height} w-full overflow-hidden border border-edge bg-paper`}>
      {segments.map((s) => (
        <div
          key={s.vaultId}
          title={`${s.vaultId} ${pct(s.fraction)}`}
          style={{ width: `${s.fraction * 100}%`, opacity: s.opacity }}
          className="bg-accent"
        />
      ))}
      {invested < 0.999 ? (
        <div
          title={`cash ${pct(1 - invested)}`}
          style={{ width: `${(1 - invested) * 100}%` }}
          className="bg-paper"
        />
      ) : null}
    </div>
  );
}

export function AllocationLegend({ order }: { order: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {order.map((vaultId, index) => (
        <span key={vaultId} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 bg-accent"
            style={{ opacity: shade(index, order.length) }}
          />
          {vaultId}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 border border-edge bg-paper" />
        cash
      </span>
    </div>
  );
}
