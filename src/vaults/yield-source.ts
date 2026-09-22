import type { VaultDef, VaultYield } from "./types.js";
import { fetchIXSYields } from "./ixs-source.js";

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

/**
 * The upstream /pools response covers every pool it tracks and runs to
 * several megabytes, so it is cached briefly. The TTL is far shorter than
 * the epoch cadence, so an epoch never reasons over stale yields — this
 * only spares the UI from refetching on each page load.
 */
const POOLS_CACHE_TTL_MS = 60_000;
let poolsCache: { fetchedAt: number; byPoolId: Map<string, LlamaPool> } | null = null;

async function fetchPools(): Promise<Map<string, LlamaPool>> {
  if (poolsCache && Date.now() - poolsCache.fetchedAt < POOLS_CACHE_TTL_MS) {
    return poolsCache.byPoolId;
  }
  const response = await fetch(`${baseUrl()}/pools`);
  if (!response.ok) {
    throw new YieldSourceError(`Yield source /pools returned ${response.status}`);
  }
  const payload = (await response.json()) as { data: LlamaPool[] };
  const byPoolId = new Map(payload.data.map((p) => [p.pool, p]));
  poolsCache = { fetchedAt: Date.now(), byPoolId };
  return byPoolId;
}

/**
 * Live yields for every configured vault, whichever source each one uses.
 * IXS vaults are read onchain; the rest come from the public index. Results
 * are returned in the policy's vault order so prompts stay stable.
 */
export async function fetchCurrentYields(vaults: VaultDef[]): Promise<VaultYield[]> {
  const ixsVaults = vaults.filter((v) => v.source === "ixs");
  const indexVaults = vaults.filter((v) => v.source !== "ixs");

  const [ixsYields, indexYields] = await Promise.all([
    ixsVaults.length > 0 ? fetchIXSYields(ixsVaults) : Promise.resolve([]),
    indexVaults.length > 0 ? fetchIndexYields(indexVaults) : Promise.resolve([]),
  ]);

  const byId = new Map([...ixsYields, ...indexYields].map((y) => [y.vaultId, y]));
  return vaults.map((v) => {
    const found = byId.get(v.vaultId);
    if (!found) throw new YieldSourceError(`No yield resolved for vault "${v.vaultId}".`);
    return found;
  });
}

/** Current live APY + TVL for index-sourced vaults. */
async function fetchIndexYields(vaults: VaultDef[]): Promise<VaultYield[]> {
  const byPoolId = await fetchPools();
  const observedAt = new Date().toISOString();

  return vaults.map((vault) => {
    if (!vault.poolId) {
      throw new YieldSourceError(`Vault "${vault.vaultId}" has no poolId configured.`);
    }
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
      apyKnown: true,
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
