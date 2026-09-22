import { describe, expect, it } from "vitest";
import { runGuardChain, spreadClearsThreshold } from "../../src/reasoning/guard-chain.js";
import type { Policy } from "../../src/reasoning/policy-graph.js";

const policy: Policy = {
  policy_version: 1,
  max_allocation_per_vault: 0.4,
  min_rebalance_spread_bps: 15,
  gross_cap: 1.0,
  vaults: [
    { vaultId: "buidl", label: "BUIDL", assetClass: "tokenized-treasury", source: "index", poolId: "p1" },
    { vaultId: "usdy", label: "USDY", assetClass: "tokenized-treasury", source: "index", poolId: "p2" },
    { vaultId: "maple-usdc", label: "Maple", assetClass: "private-credit", source: "index", poolId: "p3" },
  ],
};

describe("runGuardChain", () => {
  it("passes a valid within-cap allocation", () => {
    const result = runGuardChain({ buidl: 0.4, usdy: 0.35, "maple-usdc": 0.25 }, policy);
    expect(result).toEqual({ passed: true, violations: [] });
  });

  it("rejects a per-vault allocation above max_allocation_per_vault", () => {
    const result = runGuardChain({ buidl: 0.5 }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(
      "buidl allocation 0.5 exceeds max_allocation_per_vault 0.4",
    );
  });

  it("rejects gross exposure above gross_cap even when no single vault exceeds its cap", () => {
    const result = runGuardChain({ buidl: 0.4, usdy: 0.4, "maple-usdc": 0.4 }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("gross exposure 1.2000 exceeds gross_cap 1");
  });

  it("rejects a negative allocation", () => {
    const result = runGuardChain({ buidl: -0.1 }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("buidl allocation -0.1 is negative");
  });

  it("rejects an allocation to a vault outside the pinned set", () => {
    const result = runGuardChain({ "some-other-vault": 0.2 }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(
      'unknown vault "some-other-vault" is not in the pinned vault set',
    );
  });

  it("rejects a non-finite allocation", () => {
    const result = runGuardChain({ buidl: Number.NaN }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("buidl allocation is not a finite number");
  });

  it("accepts an allocation exactly at both caps", () => {
    const result = runGuardChain({ buidl: 0.4, usdy: 0.4, "maple-usdc": 0.2 }, policy);
    expect(result.passed).toBe(true);
  });

  it("collects every violation rather than stopping at the first", () => {
    const result = runGuardChain({ buidl: 0.9, unknown: 0.2 }, policy);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(3);
  });
});

describe("spreadClearsThreshold", () => {
  const yields = { buidl: 480, usdy: 545, "maple-usdc": 610 };

  it("returns true when the best vault beats current weighted yield by more than the threshold", () => {
    // current weighted = 480bps, best = 610bps, spread = 130bps >= 15bps
    expect(spreadClearsThreshold({ buidl: 1.0 }, yields, policy)).toBe(true);
  });

  it("returns false when already holding the best vault", () => {
    // current weighted = 610bps, best = 610bps, spread = 0bps < 15bps
    expect(spreadClearsThreshold({ "maple-usdc": 1.0 }, yields, policy)).toBe(false);
  });

  it("returns false when the spread is positive but under the threshold", () => {
    // current weighted = 600bps, best = 610bps, spread = 10bps < 15bps
    const tight = { buidl: 600, usdy: 600, "maple-usdc": 610 };
    expect(spreadClearsThreshold({ buidl: 1.0 }, tight, policy)).toBe(false);
  });

  it("returns false when there are no yields at all", () => {
    expect(spreadClearsThreshold({ buidl: 1.0 }, {}, policy)).toBe(false);
  });
});
