import type { VaultDef, VaultYield } from "./types.js";

export class YieldSourceError extends Error {}

interface LlamaPool {
  pool: string;
  apy: number | null;
  apyBase: number | null;
  tvlUsd: number | null;
  project: string;
  symbol: string;
  chain: string;
}

interface LlamaChartPoint {
  timestamp: string;
  apy: number | null;
  tvlUsd: number | null;
}

const DEFAULT_BASE = "https://yields.llama.fi";

function baseUrl(): string {
  return process.env.YIELD_SOURCE_BASE_URL ?? DEFAULT_BASE;
}

/** Current live APY + TVL for every configured vault. */
export async function fetchCurrentYields(vaults: VaultDef[]): Promise<VaultYield[]> {
  const response = await fetch(`${baseUrl()}/pools`);
  if (!response.ok) {
    throw new YieldSourceError(`Yield source /pools returned ${response.status}`);
  }
  const payload = (await response.json()) as { data: LlamaPool[] };
  const byPoolId = new Map(payload.data.map((p) => [p.pool, p]));
  const observedAt = new Date().toISOString();

  return vaults.map((vault) => {
    const pool = byPoolId.get(vault.poolId);
    if (!pool) {
      throw new YieldSourceError(
        `Vault "${vault.vaultId}" references pool ${vault.poolId}, which the yield source does not list.`,
      );
    }
    const apy = pool.apy ?? pool.apyBase;
    if (apy === null || apy === undefined) {
      throw new YieldSourceError(`Pool ${vault.poolId} reported no APY.`);
    }
    return {
      vaultId: vault.vaultId,
      poolId: vault.poolId,
      apyBps: Math.round(apy * 100),
      tvlUsd: pool.tvlUsd ?? 0,
      observedAt,
    };
  });
}

/**
 * Real historical APY series per vault, used by the benchmark to score the
 * agent against a static allocation over dates that actually happened.
 * Returns a map of vaultId -> (ISO date -> apyBps).
 */
export async function fetchHistoricalYields(
  vaults: VaultDef[],
): Promise<Record<string, Record<string, number>>> {
  const series: Record<string, Record<string, number>> = {};

  for (const vault of vaults) {
    const response = await fetch(`${baseUrl()}/chart/${vault.poolId}`);
    if (!response.ok) {
      throw new YieldSourceError(
        `Yield source /chart/${vault.poolId} returned ${response.status}`,
      );
    }
    const payload = (await response.json()) as { data: LlamaChartPoint[] };
    const byDate: Record<string, number> = {};
    for (const point of payload.data) {
      const apy = point.apy;
      if (apy === null || apy === undefined) continue;
      const date = point.timestamp.slice(0, 10);
      byDate[date] = Math.round(apy * 100);
    }
    series[vault.vaultId] = byDate;
  }

  return series;
}
