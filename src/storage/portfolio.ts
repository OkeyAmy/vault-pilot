import type { Allocation } from "../vaults/types.js";

export const DEFAULT_EQUITY_USD = 1_000_000;

export function equityUsd(): number {
  const raw = process.env.TREASURY_EQUITY_USD;
  if (!raw) return DEFAULT_EQUITY_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`TREASURY_EQUITY_USD must be a positive number, got "${raw}".`);
  }
  return parsed;
}

/** Annualized bps yield of an allocation, given per-vault APYs in bps. */
export function weightedYieldBps(
  allocation: Allocation,
  vaultYieldsBps: Record<string, number>,
): number {
  return Object.entries(allocation).reduce(
    (sum, [vaultId, fraction]) => sum + fraction * (vaultYieldsBps[vaultId] ?? 0),
    0,
  );
}

/**
 * Value equality for allocations, tolerant of key order and float noise.
 * Used wherever "did the allocation actually change?" is asked, so the
 * answer never depends on object identity.
 */
export function allocationsEqual(a: Allocation, b: Allocation): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > 1e-9) return false;
  }
  return true;
}

/** Equal-weight allocation across all vaults — the static baseline to beat. */
export function staticBaselineAllocation(vaultIds: string[]): Allocation {
  const fraction = 1 / vaultIds.length;
  return Object.fromEntries(vaultIds.map((id) => [id, fraction]));
}

/**
 * Equity after one epoch of accrual at the allocation's weighted yield.
 * `epochsPerYear` converts the annualized APY into this epoch's share
 * (365 for daily epochs).
 */
export function accrueEquity(params: {
  equityUsd: number;
  allocation: Allocation;
  vaultYieldsBps: Record<string, number>;
  epochsPerYear: number;
}): number {
  const annualRate = weightedYieldBps(params.allocation, params.vaultYieldsBps) / 10_000;
  return params.equityUsd * (1 + annualRate / params.epochsPerYear);
}
