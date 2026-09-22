const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export interface Vault {
  vaultId: string;
  label: string;
  assetClass: string;
  poolId: string;
}

export interface Arm {
  id: string;
  name: string;
  model: string;
  shadow_agent: boolean;
}

export interface Policy {
  policy_version: number;
  max_allocation_per_vault: number;
  min_rebalance_spread_bps: number;
  gross_cap: number;
  vaults: Vault[];
  arms: Arm[];
}

export interface VaultYield {
  vaultId: string;
  poolId: string;
  apyBps: number;
  tvlUsd: number;
  observedAt: string;
}

export interface ReceiptAnchor {
  tx_hash: string;
  block_number: number;
  chain_id: number;
  explorer_url: string;
}

export interface Receipt {
  epoch: number;
  model: string;
  timestamp: string;
  settlement_mode: "accounting" | "onchain";
  pre_allocation: Record<string, number>;
  post_allocation: Record<string, number>;
  observed_yields_bps: Record<string, number>;
  reasoning_model: string;
  shadow_agent: boolean;
  tx_hashes: string[];
  reasoning_cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  pre_weighted_yield_bps: number;
  post_weighted_yield_bps: number;
  yield_delta_bps: number;
  policy_checks_passed: boolean;
  policy_violations: string[];
  rationale: string;
  confidence: number;
  risk_score: number;
  receipt_hash: string;
  anchor: ReceiptAnchor | null;
}

export interface LeaderboardRow {
  model_id: string;
  reasoning_model: string;
  shadow_agent: boolean;
  epochs: number;
  rebalances: number;
  cumulative_yield_delta_bps: number;
  current_yield_bps: number;
  total_reasoning_cost_usd: number;
  cost_per_decision_usd: number;
  guard_failures: number;
  policy_compliance_pct: number;
  mean_confidence: number;
  mean_risk_score: number;
}

export interface Preflight {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  reasoning: {
    ready: boolean;
    baseUrl: string;
    servToolsActive: boolean;
    arms: string[];
  };
  anchoring: {
    enabled: boolean;
    address: string | null;
    funded: boolean | null;
    chainId: number;
  };
}

export interface RunStep {
  at: string;
  arm: string | null;
  message: string;
  level: "info" | "ok" | "warn" | "error";
}

export interface RunState {
  phase: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  steps: RunStep[];
  error: string | null;
  generation: number;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => get<{ ok: boolean; anchoring: boolean; time: string }>("/api/health"),
  preflight: () => get<Preflight>("/api/preflight"),
  policy: () => get<Policy>("/api/policy"),
  yields: () => get<VaultYield[]>("/api/yields"),
  leaderboard: () => get<LeaderboardRow[]>("/api/leaderboard"),
  receipts: () => get<Record<string, Receipt[]>>("/api/receipts"),
  runStatus: () => get<RunState>("/api/epoch/status"),

  async startEpoch(): Promise<void> {
    const response = await fetch(`${BASE}/api/epoch/run`, { method: "POST" });
    if (response.status === 409) throw new Error("An epoch is already running.");
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Could not start epoch: ${response.status} ${body.slice(0, 200)}`);
    }
  },
};
