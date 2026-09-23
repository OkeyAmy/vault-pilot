import type { Allocation } from "../vaults/types.js";
import type { Decision, Policy } from "./policy-graph.js";
import { allocationsEqual, weightedYieldBps } from "../storage/portfolio.js";

export interface GuardResult {
  passed: boolean;
  violations: string[];
}

/**
 * Deterministic, model-independent safety checks applied to every proposed
 * allocation before execution. Runs regardless of which model produced the
 * decision and regardless of its stated confidence — a violation here always
 * rejects the decision and holds the previous allocation.
 */
export function runGuardChain(allocation: Allocation, policy: Policy): GuardResult {
  const violations: string[] = [];
  const knownVaultIds = new Set(policy.vaults.map((v) => v.vaultId));

  for (const vaultId of Object.keys(allocation)) {
    if (!knownVaultIds.has(vaultId)) {
      violations.push(`unknown vault "${vaultId}" is not in the pinned vault set`);
    }
  }

  let gross = 0;
  for (const [vaultId, fraction] of Object.entries(allocation)) {
    if (!Number.isFinite(fraction)) {
      violations.push(`${vaultId} allocation is not a finite number`);
      continue;
    }
    if (fraction < 0) {
      violations.push(`${vaultId} allocation ${fraction} is negative`);
    }
    if (fraction > policy.max_allocation_per_vault) {
      violations.push(
        `${vaultId} allocation ${fraction} exceeds max_allocation_per_vault ${policy.max_allocation_per_vault}`,
      );
    }
    gross += fraction;
  }

  if (gross > policy.gross_cap + 1e-9) {
    violations.push(`gross exposure ${gross.toFixed(4)} exceeds gross_cap ${policy.gross_cap}`);
  }

  return { passed: violations.length === 0, violations };
}

/**
 * True if the best available vault beats the current allocation's weighted
 * yield by at least the policy's minimum spread. Used to reject
 * rebalance-for-its-own-sake decisions with no material yield benefit.
 */
export function spreadClearsThreshold(
  currentAllocation: Allocation,
  vaultYieldsBps: Record<string, number>,
  policy: Policy,
): boolean {
  const yieldValues = Object.values(vaultYieldsBps);
  if (yieldValues.length === 0) return false;
  const currentWeightedBps = weightedYieldBps(currentAllocation, vaultYieldsBps);
  const bestVaultBps = Math.max(...yieldValues);
  return bestVaultBps - currentWeightedBps >= policy.min_rebalance_spread_bps;
}

export interface AppliedDecision {
  postAllocation: Allocation;
  passed: boolean;
  violations: string[];
}

/**
 * Applies a model decision under the full policy: allocation caps via
 * runGuardChain, then the minimum rebalance spread when the model proposes
 * an actual reallocation. Any violation holds the previous allocation.
 * This — not the prompt — is what makes the policy deterministic.
 */
export function applyDecision(
  decision: Decision,
  preAllocation: Allocation,
  vaultYieldsBps: Record<string, number>,
  policy: Policy,
): AppliedDecision {
  const guard = runGuardChain(decision.target_allocation, policy);
  const violations = [...guard.violations];

  const wouldReallocate =
    decision.should_rebalance &&
    !allocationsEqual(preAllocation, decision.target_allocation);

  if (guard.passed && wouldReallocate && !spreadClearsThreshold(preAllocation, vaultYieldsBps, policy)) {
    const currentBps = weightedYieldBps(preAllocation, vaultYieldsBps);
    const bestBps = Math.max(...Object.values(vaultYieldsBps));
    violations.push(
      `rebalance rejected: best available spread ${Math.round(bestBps - currentBps)}bps ` +
        `does not clear min_rebalance_spread_bps ${policy.min_rebalance_spread_bps}`,
    );
  }

  const passed = violations.length === 0;
  const postAllocation =
    passed && decision.should_rebalance ? decision.target_allocation : preAllocation;
  return { postAllocation, passed, violations };
}
