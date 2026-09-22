import { describe, expect, it } from "vitest";
import {
  allocationsEqual,
  weightedYieldBps,
  staticBaselineAllocation,
  accrueEquity,
} from "../../src/storage/portfolio.js";

describe("allocationsEqual", () => {
  it("ignores key order", () => {
    // blindfold: contract — allocations are maps; order carries no meaning.
    expect(allocationsEqual({ a: 0.5, b: 0.5 }, { b: 0.5, a: 0.5 })).toBe(true);
  });

  it("treats an absent key as zero", () => {
    // blindfold: contract — an omitted vault means zero allocation, per the
    // decision schema's documented "omitted vaults are treated as 0".
    expect(allocationsEqual({ a: 0.5 }, { a: 0.5, b: 0 })).toBe(true);
  });

  it("detects a real change", () => {
    // blindfold: invariant — a comparison that cannot see 0.5 vs 0.6 would
    // record every rebalance as a hold and corrupt the leaderboard.
    expect(allocationsEqual({ a: 0.5 }, { a: 0.6 })).toBe(false);
  });

  it("tolerates float representation noise", () => {
    // blindfold: math — 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 binary64,
    // a ~5.5e-17 error, far below the 1e-9 tolerance.
    expect(allocationsEqual({ a: 0.1 + 0.2 }, { a: 0.3 })).toBe(true);
  });

  it("does not treat a 1e-6 difference as noise", () => {
    // blindfold: contract — the tolerance is 1e-9, so a millionth is a real change.
    expect(allocationsEqual({ a: 0.5 }, { a: 0.500001 })).toBe(false);
  });

  it("considers two empty allocations equal", () => {
    expect(allocationsEqual({}, {})).toBe(true);
  });
});

describe("weightedYieldBps", () => {
  it("weights each vault by its fraction", () => {
    // blindfold: math — 0.5*400 + 0.5*600 = 200 + 300 = 500.
    expect(weightedYieldBps({ a: 0.5, b: 0.5 }, { a: 400, b: 600 })).toBe(500);
  });

  it("treats a missing yield as zero rather than throwing", () => {
    // blindfold: contract — a vault with no observed yield contributes nothing.
    expect(weightedYieldBps({ a: 1.0 }, {})).toBe(0);
  });

  it("returns the vault's full yield when fully allocated", () => {
    // blindfold: math — 1.0 * 377 = 377.
    expect(weightedYieldBps({ a: 1.0 }, { a: 377 })).toBe(377);
  });

  it("scales down when partially allocated (cash earns nothing)", () => {
    // blindfold: math — 0.4 * 500 = 200; the uninvested 60% yields zero.
    expect(weightedYieldBps({ a: 0.4 }, { a: 500 })).toBe(200);
  });
});

describe("staticBaselineAllocation", () => {
  it("splits equally across four vaults", () => {
    // blindfold: math — 1/4 = 0.25 per vault.
    expect(staticBaselineAllocation(["a", "b", "c", "d"])).toEqual({
      a: 0.25,
      b: 0.25,
      c: 0.25,
      d: 0.25,
    });
  });

  it("sums to one so the baseline is fully invested", () => {
    // blindfold: invariant — the baseline must be comparable to a gross_cap
    // of 1.0, or the agent would be scored against an under-invested strawman.
    const alloc = staticBaselineAllocation(["a", "b", "c"]);
    expect(Object.values(alloc).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe("accrueEquity", () => {
  it("accrues one day of a 365bps annual yield", () => {
    // blindfold: math — 365bps = 3.65%/yr; over 1/365 of a year that is
    // 0.01%/day, so $1,000,000 * 1.0001 = $1,000,100.
    expect(
      accrueEquity({
        equityUsd: 1_000_000,
        allocation: { a: 1.0 },
        vaultYieldsBps: { a: 365 },
        epochsPerYear: 365,
      }),
    ).toBeCloseTo(1_000_100, 6);
  });

  it("leaves equity unchanged at zero yield", () => {
    // blindfold: math — multiplying by (1 + 0) is the identity.
    expect(
      accrueEquity({
        equityUsd: 500_000,
        allocation: { a: 1.0 },
        vaultYieldsBps: { a: 0 },
        epochsPerYear: 365,
      }),
    ).toBe(500_000);
  });

  it("accrues the full annual rate when the epoch is a whole year", () => {
    // blindfold: math — 500bps = 5%; $1,000,000 * 1.05 = $1,050,000.
    expect(
      accrueEquity({
        equityUsd: 1_000_000,
        allocation: { a: 1.0 },
        vaultYieldsBps: { a: 500 },
        epochsPerYear: 1,
      }),
    ).toBeCloseTo(1_050_000, 6);
  });
});
