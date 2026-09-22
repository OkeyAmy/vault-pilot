import { writeFileSync } from "node:fs";
import { loadModelConfigs } from "../reasoning/model-configs.js";
import { listReceipts, type SignedReceipt } from "./receipts.js";
import { allocationsEqual } from "./portfolio.js";

export interface LeaderboardRow {
  model_id: string;
  reasoning_model: string;
  shadow_agent: boolean;
  epochs: number;
  rebalances: number;
  /** Sum of realized per-epoch yield improvements, in bps. */
  cumulative_yield_delta_bps: number;
  /** Weighted yield of the latest recorded allocation, in bps. */
  current_yield_bps: number;
  total_reasoning_cost_usd: number;
  cost_per_decision_usd: number;
  guard_failures: number;
  policy_compliance_pct: number;
  mean_confidence: number;
  mean_risk_score: number;
  /** Where this arm currently sits — the point of comparing arms at all. */
  current_allocation: Record<string, number>;
  /** Most recent reasoning, so the table can show why, not only how much. */
  latest_rationale: string;
  receipts_anchored: number;
  last_epoch_at: string;
}

function summarize(modelId: string, receipts: SignedReceipt[]): LeaderboardRow | null {
  if (receipts.length === 0) return null;
  const last = receipts[receipts.length - 1]!;
  const guardFailures = receipts.filter((r) => !r.policy_checks_passed).length;
  const totalCost = receipts.reduce((s, r) => s + r.reasoning_cost_usd, 0);
  const rebalances = receipts.filter(
    (r) => !allocationsEqual(r.pre_allocation, r.post_allocation),
  ).length;

  return {
    model_id: modelId,
    reasoning_model: last.reasoning_model,
    shadow_agent: last.shadow_agent,
    epochs: receipts.length,
    rebalances,
    cumulative_yield_delta_bps: receipts.reduce((s, r) => s + r.yield_delta_bps, 0),
    current_yield_bps: last.post_weighted_yield_bps,
    total_reasoning_cost_usd: totalCost,
    cost_per_decision_usd: totalCost / receipts.length,
    guard_failures: guardFailures,
    policy_compliance_pct: ((receipts.length - guardFailures) / receipts.length) * 100,
    mean_confidence: receipts.reduce((s, r) => s + r.confidence, 0) / receipts.length,
    mean_risk_score: receipts.reduce((s, r) => s + r.risk_score, 0) / receipts.length,
    current_allocation: last.post_allocation,
    latest_rationale: last.rationale,
    receipts_anchored: receipts.filter((r) => r.anchor).length,
    last_epoch_at: last.timestamp,
  };
}

export function buildLeaderboard(): LeaderboardRow[] {
  return loadModelConfigs()
    .map((m) => summarize(m.id, listReceipts(m.id)))
    .filter((row): row is LeaderboardRow => row !== null)
    .sort((a, b) => b.cumulative_yield_delta_bps - a.cumulative_yield_delta_bps);
}

export function writeLeaderboardJson(path = "leaderboard.json"): LeaderboardRow[] {
  const rows = buildLeaderboard();
  writeFileSync(path, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));
  return rows;
}
