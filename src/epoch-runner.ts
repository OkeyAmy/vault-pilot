import { loadPolicy } from "./config/load-policy.js";
import { loadModelConfigs, estimateReasoningCostUsd, type ModelConfig } from "./reasoning/model-configs.js";
import { buildSystemPrompt, buildUserPrompt, type Policy } from "./reasoning/policy-graph.js";
import { runGuardChain } from "./reasoning/guard-chain.js";
import { requestDecision, servToolsSupported, resolvedBaseUrl } from "./reasoning/serv-client.js";
import { fetchCurrentYields } from "./vaults/yield-source.js";
import type { Allocation, VaultYield } from "./vaults/types.js";
import {
  weightedYieldBps,
  staticBaselineAllocation,
  allocationsEqual,
} from "./storage/portfolio.js";
import {
  computeReceiptHash,
  latestEpoch,
  listReceipts,
  signReceipt,
  writeReceipt,
  type Receipt,
  type ReceiptAnchor,
  type SettlementMode,
} from "./storage/receipts.js";
import { anchorReceiptHash, anchoringEnabled, explorerUrl } from "./storage/anchor.js";

/** Allocation carried into this epoch: the last recorded post_allocation. */
function currentAllocation(modelId: string, policy: Policy): Allocation {
  const receipts = listReceipts(modelId);
  const last = receipts[receipts.length - 1];
  return last
    ? last.post_allocation
    : staticBaselineAllocation(policy.vaults.map((v) => v.vaultId));
}

function settlementMode(): SettlementMode {
  return process.env.WALLET_PRIVATE_KEY ? "onchain" : "accounting";
}

export interface EpochOutcome {
  modelId: string;
  epoch: number;
  receiptPath: string;
  rebalanced: boolean;
  yieldDeltaBps: number;
  guardPassed: boolean;
  anchorTxHash: string | null;
}

export async function runEpochForModel(params: {
  model: ModelConfig;
  policy: Policy;
  yields: VaultYield[];
  epoch: number;
  onProgress?: ProgressFn;
}): Promise<EpochOutcome> {
  const { model, policy, yields, epoch } = params;
  const onProgress = params.onProgress ?? noopProgress;
  const yieldsBps = Object.fromEntries(yields.map((y) => [y.vaultId, y.apyBps]));
  const preAllocation = currentAllocation(model.id, policy);

  const result = await requestDecision({
    model,
    systemPrompt: buildSystemPrompt(policy),
    userPrompt: buildUserPrompt({
      epoch,
      currentAllocation: preAllocation,
      yields,
      vaults: policy.vaults,
    }),
  });

  const guard = runGuardChain(result.decision.target_allocation, policy);
  // A failed guard check holds the previous allocation. The rejected proposal
  // is still recorded in the receipt via policy_violations.
  const postAllocation =
    guard.passed && result.decision.should_rebalance
      ? result.decision.target_allocation
      : preAllocation;

  const preYield = weightedYieldBps(preAllocation, yieldsBps);
  const postYield = weightedYieldBps(postAllocation, yieldsBps);

  const receipt: Receipt = {
    epoch,
    model: model.id,
    timestamp: new Date().toISOString(),
    settlement_mode: settlementMode(),
    pre_allocation: preAllocation,
    post_allocation: postAllocation,
    observed_yields_bps: yieldsBps,
    yield_source: process.env.YIELD_SOURCE_BASE_URL ?? "https://yields.llama.fi",
    reasoning_model: model.model,
    // Records whether the validation loop was actually applied, not merely
    // requested: an endpoint that does not implement serv_* tools makes this
    // arm identical to its base counterpart, and the receipt must say so.
    shadow_agent: model.useShadowAgent && servToolsSupported(resolvedBaseUrl()),
    response_id: result.responseId,
    tx_hashes: [],
    reasoning_cost_usd: estimateReasoningCostUsd(
      model,
      result.promptTokens,
      result.completionTokens,
    ),
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    pre_weighted_yield_bps: preYield,
    post_weighted_yield_bps: postYield,
    yield_delta_bps: postYield - preYield,
    policy_checks_passed: guard.passed,
    policy_violations: guard.violations,
    rationale: result.decision.rationale,
    confidence: result.decision.confidence,
    risk_score: result.decision.risk_score,
  };

  const receiptHash = computeReceiptHash(receipt);

  let anchor: ReceiptAnchor | null = null;
  if (anchoringEnabled()) {
    onProgress("Publishing receipt hash onchain", "info", model.id);
    const result = await anchorReceiptHash(receiptHash);
    onProgress(`Anchored in block ${result.blockNumber}`, "ok", model.id);
    anchor = {
      tx_hash: result.txHash,
      block_number: result.blockNumber,
      chain_id: result.chainId,
      explorer_url: explorerUrl(result.txHash),
    };
  }

  const receiptPath = writeReceipt(signReceipt(receipt, anchor));

  return {
    modelId: model.id,
    epoch,
    receiptPath,
    rebalanced: !allocationsEqual(preAllocation, postAllocation),
    yieldDeltaBps: receipt.yield_delta_bps,
    guardPassed: guard.passed,
    anchorTxHash: anchor?.tx_hash ?? null,
  };
}

export type ProgressFn = (
  message: string,
  level?: "info" | "ok" | "warn" | "error",
  arm?: string | null,
) => void;

const noopProgress: ProgressFn = () => {};

/**
 * Runs one epoch across every tournament arm against the same live yield
 * snapshot, so the arms are judged on identical data.
 *
 * `onProgress` receives human-readable step updates so a caller (the API,
 * and through it the UI) can show the run happening rather than blocking
 * silently for the length of several model calls.
 */
export async function runTournamentEpoch(
  onProgress: ProgressFn = noopProgress,
): Promise<EpochOutcome[]> {
  const policy = loadPolicy();
  const models = loadModelConfigs();

  onProgress(`Fetching live yields for ${policy.vaults.length} vaults`);
  const yields = await fetchCurrentYields(policy.vaults);
  const best = yields.reduce((a, b) => (b.apyBps > a.apyBps ? b : a));
  const worst = yields.reduce((a, b) => (b.apyBps < a.apyBps ? b : a));
  onProgress(
    `Yields in: best ${best.vaultId} ${(best.apyBps / 100).toFixed(2)}%, ` +
      `spread ${(best.apyBps - worst.apyBps).toFixed(0)}bps`,
    "ok",
  );

  if (anchoringEnabled()) {
    onProgress("Anchoring enabled — each receipt hash will be published onchain");
  } else {
    onProgress("Anchoring disabled (no ANCHOR_PRIVATE_KEY) — receipts will not be anchored", "warn");
  }

  const outcomes: EpochOutcome[] = [];
  for (const model of models) {
    const epoch = latestEpoch(model.id) + 1;
    onProgress(`Requesting decision from ${model.model}`, "info", model.id);
    try {
      const outcome = await runEpochForModel({ model, policy, yields, epoch, onProgress });
      outcomes.push(outcome);
      onProgress(
        `Epoch ${outcome.epoch} ${outcome.rebalanced ? "rebalanced" : "held"}, ` +
          `yield delta ${outcome.yieldDeltaBps >= 0 ? "+" : ""}${outcome.yieldDeltaBps.toFixed(2)}bps` +
          (outcome.guardPassed ? "" : " (guards held previous allocation)"),
        outcome.guardPassed ? "ok" : "warn",
        model.id,
      );
    } catch (err) {
      // One arm failing must not abort the tournament; the others still run.
      const message = (err as Error).message;
      console.error(`[${model.id}] epoch ${epoch} failed: ${message}`);
      onProgress(message, "error", model.id);
    }
  }

  if (outcomes.length === 0) {
    throw new Error(
      `Every arm failed this epoch. First check that SERV_API_KEY is set and valid.`,
    );
  }

  onProgress(`Epoch complete: ${outcomes.length}/${models.length} arms recorded`, "ok");
  return outcomes;
}
