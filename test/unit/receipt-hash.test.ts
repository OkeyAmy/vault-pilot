import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeReceiptHash,
  signReceipt,
  type Receipt,
} from "../../src/storage/receipts.js";

const receipt: Receipt = {
  epoch: 1,
  model: "base-a",
  timestamp: "2026-09-22T19:00:00.000Z",
  settlement_mode: "accounting",
  pre_allocation: { buidl: 0.25, usdy: 0.25 },
  post_allocation: { usdy: 0.4, buidl: 0.4 },
  observed_yields_bps: { buidl: 377, usdy: 359 },
  yield_source: "https://yields.llama.fi",
  reasoning_model: "gpt-5.4-mini",
  shadow_agent: false,
  response_id: "resp_x",
  tx_hashes: [],
  reasoning_cost_usd: 0.0012345,
  prompt_tokens: 810,
  completion_tokens: 140,
  pre_weighted_yield_bps: 184,
  post_weighted_yield_bps: 294.4,
  yield_delta_bps: 110.4,
  policy_checks_passed: true,
  policy_violations: [],
  rationale: 'unicode ✓ and "quotes"',
  confidence: 0.72,
  risk_score: 0.35,
};

describe("canonicalJson", () => {
  it("is independent of key insertion order", () => {
    // blindfold: contract — canonicalJson is specified to sort keys so that
    // identical content always hashes identically regardless of construction.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    // Key sorting must recurse, or nested objects (pre_allocation,
    // observed_yields_bps) would hash unstably.
    // blindfold: contract — canonicalJson sorts object keys at every depth.
    expect(canonicalJson({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    // tx_hashes is an array whose order is data, so arrays must NOT be
    // sorted even though objects are.
    // blindfold: contract — canonicalJson preserves array order verbatim.
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace", () => {
    // The hash is taken over this exact byte string, so it must contain no
    // separator whitespace for Python to reproduce it.
    // blindfold: contract — canonicalJson emits no spaces after ':' or ','.
    expect(canonicalJson({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it("escapes quotes and keeps unicode unescaped", () => {
    // Python's json.dumps(ensure_ascii=False) must agree for cross-language
    // parity, which is why unicode stays literal rather than \u-escaped.
    // blindfold: standard — ECMA-404 escaping; `"` becomes `\"`, unicode stays literal.
    expect(canonicalJson('say "hi" ✓')).toBe('"say \\"hi\\" ✓"');
  });
});

describe("computeReceiptHash", () => {
  it("produces the pinned digest for a known receipt", () => {
    // blindfold: golden — SHA-256 over canonicalJson(receipt), captured from a
    // standalone Node run and independently reproduced by scripts/verify.py's
    // compute_hash on the same fixture. If this changes, every receipt already
    // issued becomes unverifiable: that is a breaking change, not a stale test.
    expect(computeReceiptHash(receipt)).toBe(
      "ad84330c5e630a6614973ac28fd1410ff210426a1a0f7257ed0615269ca73ba2",
    );
  });

  it("changes when a numeric field is tampered with", () => {
    // blindfold: invariant — a hash that survives content edits provides no
    // tamper evidence at all, which is the entire point of the receipt.
    const tampered = { ...receipt, yield_delta_bps: 999 };
    expect(computeReceiptHash(tampered)).not.toBe(computeReceiptHash(receipt));
  });

  it("changes when an allocation is tampered with", () => {
    // blindfold: invariant — allocations are the security-relevant payload.
    const tampered = { ...receipt, post_allocation: { usdy: 0.9, buidl: 0.4 } };
    expect(computeReceiptHash(tampered)).not.toBe(computeReceiptHash(receipt));
  });
});

describe("signReceipt", () => {
  it("excludes receipt_hash and anchor from the hashed body", () => {
    // blindfold: invariant — the anchor records where the hash was published,
    // so it is written after hashing. If it fed into the hash, anchoring would
    // invalidate the very hash it publishes.
    const withAnchor = signReceipt(receipt, {
      tx_hash: "0xabc",
      block_number: 1,
      chain_id: 84532,
      explorer_url: "https://sepolia.basescan.org/tx/0xabc",
    });
    const withoutAnchor = signReceipt(receipt, null);
    expect(withAnchor.receipt_hash).toBe(withoutAnchor.receipt_hash);
  });

  it("carries the anchor through onto the signed receipt unmodified", () => {
    const anchor = {
      tx_hash: "0xabc",
      block_number: 7,
      chain_id: 84532,
      explorer_url: "https://sepolia.basescan.org/tx/0xabc",
    };
    // blindfold: contract — signReceipt passes the anchor through verbatim;
    // verify.py --rpc reads these exact fields to locate the onchain record.
    expect(signReceipt(receipt, anchor).anchor).toEqual(anchor);
  });

  it("writes an explicit null anchor when the receipt is not anchored", () => {
    // blindfold: contract — verify.py distinguishes "not anchored" from
    // "anchor missing from the file", so the key must be present and null
    // rather than absent.
    const signed = signReceipt(receipt);
    expect(signed.anchor).toBeNull();
    expect("anchor" in signed).toBe(true);
  });

  it("matches the digest computed directly by computeReceiptHash", () => {
    // blindfold: invariant — signReceipt must hash the same bytes that
    // computeReceiptHash does, or verification would fail on every receipt.
    expect(signReceipt(receipt).receipt_hash).toBe(computeReceiptHash(receipt));
  });
});
