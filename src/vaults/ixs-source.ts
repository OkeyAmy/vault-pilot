import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { bsc } from "viem/chains";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { VaultDef, VaultYield } from "./types.js";

export class IXSSourceError extends Error {}

/**
 * ERC-4626 surface. IXS vaults are standard 4626 wrappers over tokenized
 * real-world assets, so share price is the yield signal: assets per share
 * rises as the underlying accrues.
 */
const VAULT_ABI = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function asset() view returns (address)",
]);

const HISTORY_PATH = process.env.IXS_HISTORY_PATH ?? "data/ixs-share-price-history.json";

interface PricePoint {
  at: string;
  sharePrice: number;
}

type History = Record<string, PricePoint[]>;

function loadHistory(): History {
  if (!existsSync(HISTORY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) as History;
  } catch {
    return {};
  }
}

function saveHistory(history: History): void {
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");
}

function client() {
  return createPublicClient({
    chain: bsc,
    transport: http(process.env.IXS_RPC_URL ?? "https://bsc-dataseed.binance.org"),
  });
}

export interface IXSVaultState {
  vaultId: string;
  address: string;
  symbol: string;
  sharePrice: number;
  totalAssets: number;
  decimals: number;
  observedAt: string;
}

/** Live ERC-4626 state for one IXS vault, read directly from the chain. */
export async function readVaultState(vault: VaultDef): Promise<IXSVaultState> {
  if (!vault.address) {
    throw new IXSSourceError(`Vault "${vault.vaultId}" has no contract address configured.`);
  }
  const address = vault.address as `0x${string}`;
  const publicClient = client();

  const [decimals, symbol, totalAssets, totalSupply] = await Promise.all([
    publicClient.readContract({ address, abi: VAULT_ABI, functionName: "decimals" }),
    publicClient.readContract({ address, abi: VAULT_ABI, functionName: "symbol" }),
    publicClient.readContract({ address, abi: VAULT_ABI, functionName: "totalAssets" }),
    publicClient.readContract({ address, abi: VAULT_ABI, functionName: "totalSupply" }),
  ]);

  if (totalSupply === 0n) {
    throw new IXSSourceError(`Vault ${vault.vaultId} has zero supply; share price is undefined.`);
  }

  // convertToAssets(1 share) is the canonical 4626 way to read share price,
  // and it respects any vault-specific rounding or fee logic.
  const oneShare = 10n ** BigInt(decimals);
  const assetsPerShare = await publicClient.readContract({
    address,
    abi: VAULT_ABI,
    functionName: "convertToAssets",
    args: [oneShare],
  });

  return {
    vaultId: vault.vaultId,
    address,
    symbol,
    sharePrice: Number(formatUnits(assetsPerShare, decimals)),
    totalAssets: Number(formatUnits(totalAssets, decimals)),
    decimals,
    observedAt: new Date().toISOString(),
  };
}

/**
 * Annualized yield implied by the change in share price since the earliest
 * recorded sample. Returns null when there is not yet enough history — the
 * agent is told "unknown", never a fabricated number.
 */
const MIN_WINDOW_HOURS = Number(process.env.IXS_MIN_YIELD_WINDOW_HOURS ?? 6);

export function impliedApyBps(history: PricePoint[], current: PricePoint): number | null {
  const earliest = history[0];
  if (!earliest) return null;
  if (earliest.sharePrice <= 0) return null;

  const elapsedMs = new Date(current.at).getTime() - new Date(earliest.at).getTime();
  if (elapsedMs < MIN_WINDOW_HOURS * 60 * 60 * 1000) return null;

  // An unchanged share price is not evidence of zero yield. These vaults
  // accrue slowly enough that a realistic APY moves the price by less than
  // the precision we can read over a short window, so an identical reading
  // means "not resolved yet", not "earned nothing". Reporting 0% here would
  // be the one thing this project refuses to do: invent a number.
  if (current.sharePrice === earliest.sharePrice) return null;

  const growth = current.sharePrice / earliest.sharePrice - 1;
  const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / elapsedMs;
  return Math.round(growth * periodsPerYear * 10_000);
}

/** Samples closer together than this add noise without adding information. */
const MIN_SAMPLE_GAP_MS = Number(process.env.IXS_MIN_SAMPLE_GAP_MINUTES ?? 5) * 60 * 1000;

function shouldRecord(series: PricePoint[], point: PricePoint): boolean {
  const last = series[series.length - 1];
  if (!last) return true;
  if (last.sharePrice !== point.sharePrice) return true;
  return new Date(point.at).getTime() - new Date(last.at).getTime() >= MIN_SAMPLE_GAP_MS;
}

/**
 * Reads every configured IXS vault onchain, appends this observation to the
 * local share-price history, and derives an APY from that history.
 */
export async function fetchIXSYields(vaults: VaultDef[]): Promise<VaultYield[]> {
  const history = loadHistory();
  const results: VaultYield[] = [];

  for (const vault of vaults) {
    const state = await readVaultState(vault);
    const point: PricePoint = { at: state.observedAt, sharePrice: state.sharePrice };
    const series = history[vault.vaultId] ?? [];
    const apyBps = impliedApyBps(series, point);

    if (shouldRecord(series, point)) {
      series.push(point);
      // Keep the window bounded; the earliest point anchors the APY estimate.
      history[vault.vaultId] = series.slice(-500);
    }

    results.push({
      vaultId: vault.vaultId,
      poolId: state.address,
      apyBps: apyBps ?? 0,
      apyKnown: apyBps !== null,
      tvlUsd: state.totalAssets,
      sharePrice: state.sharePrice,
      observedAt: state.observedAt,
    });
  }

  saveHistory(history);
  return results;
}
