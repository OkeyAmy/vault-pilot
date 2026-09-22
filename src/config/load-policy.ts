import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { Policy } from "../reasoning/policy-graph.js";

const PolicySchema = z.object({
  policy_version: z.number().int().positive(),
  max_allocation_per_vault: z.number().gt(0).max(1),
  min_rebalance_spread_bps: z.number().min(0),
  gross_cap: z.number().gt(0),
  vaults: z
    .array(
      z.object({
        vaultId: z.string().min(1),
        label: z.string().min(1),
        assetClass: z.enum([
          "tokenized-treasury",
          "private-credit",
          "savings",
          "structured-credit",
        ]),
        source: z.enum(["ixs", "index"]).default("index"),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
        poolId: z.string().min(1).optional(),
      })
        .refine((v) => (v.source === "ixs" ? Boolean(v.address) : Boolean(v.poolId)), {
          message:
            'vaults with source "ixs" need an `address`; vaults with source "index" need a `poolId`',
        }),
    )
    .min(2),
});

export function loadPolicy(path?: string): Policy {
  const resolved =
    path ?? process.env.POLICY_PATH ?? join(dirname(fileURLToPath(import.meta.url)), "policy.yaml");
  // js-yaml v4's load() uses DEFAULT_SCHEMA, which does not construct
  // arbitrary types. Shape is still validated below.
  const raw = yaml.load(readFileSync(resolved, "utf-8"));
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid policy file at ${resolved}: ${parsed.error.message}`);
  }
  const policy = parsed.data;
  if (policy.max_allocation_per_vault * policy.vaults.length < policy.gross_cap) {
    throw new Error(
      `Policy is unsatisfiable: ${policy.vaults.length} vaults capped at ` +
        `${policy.max_allocation_per_vault} each cannot reach gross_cap ${policy.gross_cap}.`,
    );
  }
  const ids = policy.vaults.map((v) => v.vaultId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Policy has duplicate vaultId values: ${ids.join(", ")}`);
  }
  return policy;
}
