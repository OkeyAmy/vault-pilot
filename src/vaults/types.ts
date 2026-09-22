export interface VaultDef {
  /** Stable internal id used in allocations, prompts and receipts. */
  vaultId: string;
  label: string;
  assetClass: "tokenized-treasury" | "private-credit" | "savings" | "structured-credit";
  /** DeFiLlama pool uuid — the live yield source for this vault. */
  poolId: string;
}

export interface VaultYield {
  vaultId: string;
  poolId: string;
  apyBps: number;
  tvlUsd: number;
  /** Timestamp reported by the upstream source for this datapoint. */
  observedAt: string;
}

/** Fraction of total equity allocated to each vaultId, e.g. { "buidl": 0.4 }. */
export type Allocation = Record<string, number>;

export interface AllocationChange {
  vaultId: string;
  side: "increase" | "decrease";
  amountUsd: number;
}
