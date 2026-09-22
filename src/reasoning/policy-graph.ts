import { z } from "zod";
import type { VaultDef } from "../vaults/types.js";

export interface Policy {
  policy_version: number;
  max_allocation_per_vault: number;
  min_rebalance_spread_bps: number;
  gross_cap: number;
  vaults: VaultDef[];
}

/**
 * Structured decision contract every model must fill in, enforced via
 * tool-calling. This schema, together with the guard chain in
 * guard-chain.ts, IS the reasoning graph: yields -> spread calc -> policy
 * check -> decision -> guard validation -> attestation, each step typed
 * and auditable.
 */
export const DecisionSchema = z.object({
  schema_version: z.literal(1),
  should_rebalance: z.boolean(),
  target_allocation: z.record(z.string(), z.number().min(0).max(1)),
  rationale: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  risk_score: z.number().min(0).max(1),
});

export type Decision = z.infer<typeof DecisionSchema>;

/** JSON Schema mirror of DecisionSchema for the tool-calling contract. */
export const DECISION_TOOL_JSON_SCHEMA = {
  type: "object",
  properties: {
    schema_version: { type: "integer", enum: [1] },
    should_rebalance: { type: "boolean" },
    target_allocation: {
      type: "object",
      description:
        "Map of vaultId -> fraction of total equity (0..1). Omitted vaults are treated as 0.",
      additionalProperties: { type: "number", minimum: 0, maximum: 1 },
    },
    rationale: { type: "string", maxLength: 2000 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    risk_score: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "schema_version",
    "should_rebalance",
    "target_allocation",
    "rationale",
    "confidence",
    "risk_score",
  ],
  additionalProperties: false,
} as const;

export function buildSystemPrompt(policy: Policy): string {
  const vaultLines = policy.vaults
    .map((v) => `- ${v.vaultId} (${v.label}, ${v.assetClass})`)
    .join("\n");
  return [
    "You are the reasoning core of VAULT-PILOT, an autonomous treasury allocator for tokenized real-world-asset vaults.",
    "You must call submit_decision exactly once with a target_allocation across only these vaults:",
    vaultLines,
    "",
    "Policy constraints (enforced again by a deterministic guard chain after you decide):",
    `- max_allocation_per_vault: ${policy.max_allocation_per_vault}`,
    `- gross_cap (sum of all allocations): ${policy.gross_cap}`,
    `- only rebalance if the best available spread vs. the current allocation exceeds ${policy.min_rebalance_spread_bps}bps`,
    "",
    "This is a risk-adjusted decision, not a yield-maximisation exercise. Weigh:",
    "- Credit risk: private and structured credit carry real default risk; tokenized treasuries are far safer. A higher APY does not by itself justify a move.",
    "- Liquidity and concentration: a vault with very low TVL cannot absorb a large allocation without becoming a concentration risk.",
    "- Uncertainty: a vault whose apy_status is insufficient_history has no observed yield yet. Decide deliberately whether unproven yield is worth capital, and say why in your rationale.",
    "",
    "State the trade-off you actually made in the rationale, including what you chose not to do.",
    "Only include vaults you are actively allocating to in target_allocation; omitted vaults are treated as 0.",
    "Set should_rebalance=false and keep target_allocation equal to the current allocation if no move clears the spread threshold.",
  ].join("\n");
}

export function buildUserPrompt(input: {
  epoch: number;
  currentAllocation: Record<string, number>;
  yields: {
    vaultId: string;
    apyBps: number;
    apyKnown?: boolean;
    tvlUsd: number;
    sharePrice?: number;
  }[];
  vaults: VaultDef[];
}): string {
  const byId = new Map(input.vaults.map((v) => [v.vaultId, v]));

  const vaultData = Object.fromEntries(
    input.yields.map((y) => {
      const def = byId.get(y.vaultId);
      const known = y.apyKnown !== false;
      return [
        y.vaultId,
        {
          asset_class: def?.assetClass ?? "unknown",
          // An unproven vault reports no yield rather than a misleading zero;
          // deciding what to do with that uncertainty is part of the task.
          apy_bps: known ? y.apyBps : null,
          apy_status: known ? "observed" : "insufficient_history",
          tvl_usd: Math.round(y.tvlUsd),
          ...(y.sharePrice === undefined ? {} : { share_price: y.sharePrice }),
          read_from: def?.source === "ixs" ? "onchain_erc4626" : "public_index",
        },
      ];
    }),
  );

  return JSON.stringify(
    { epoch: input.epoch, current_allocation: input.currentAllocation, vaults: vaultData },
    null,
    2,
  );
}
