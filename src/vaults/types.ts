export type VaultSource = "ixs" | "index";

export interface VaultDef {
  /** Stable internal id used in allocations, prompts and receipts. */
  vaultId: string;
  label: string;
  assetClass: "tokenized-treasury" | "private-credit" | "savings" | "structured-credit";
  /**
   * `ixs`   — an ERC-4626 IXS vault read directly onchain via `address`.
   * `index` — a tokenized-RWA vault whose yield is read from a public index
   *           via `poolId`.
   */
  source: VaultSource;
  /** Contract address, for `source: "ixs"`. */
  address?: string;
  /** Index pool identifier, for `source: "index"`. */
  poolId?: string;
}

export interface VaultYield {
  vaultId: string;
  poolId: string;
  apyBps: number;
  /**
   * False when yield could not yet be derived (an onchain vault needs two
   * share-price samples). Callers must not treat apyBps as meaningful.
   */
  apyKnown?: boolean;
  tvlUsd: number;
  /** ERC-4626 assets-per-share, when read onchain. */
  sharePrice?: number;
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
