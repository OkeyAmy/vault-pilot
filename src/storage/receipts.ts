import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Allocation } from "../vaults/types.js";

/**
 * `accounting` — allocation of record was updated from live yield data, with
 * no onchain transfer (no wallet configured).
 * `onchain`    — allocation was moved by real transactions; tx_hashes is
 * non-empty and independently checkable on a block explorer.
 */
export type SettlementMode = "accounting" | "onchain";

export interface Receipt {
  epoch: number;
  model: string;
  timestamp: string;
  settlement_mode: SettlementMode;
  pre_allocation: Allocation;
  post_allocation: Allocation;
  observed_yields_bps: Record<string, number>;
  yield_source: string;
  reasoning_model: string;
  shadow_agent: boolean;
  response_id: string;
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
}

export interface ReceiptAnchor {
  tx_hash: string;
  block_number: number;
  chain_id: number;
  explorer_url: string;
}

/**
 * `receipt_hash` covers the Receipt body only. `anchor` is written after
 * hashing (it records where that hash was published onchain), so both keys
 * are excluded when recomputing the hash — in this file and in verify.py.
 */
export type SignedReceipt = Receipt & {
  receipt_hash: string;
  anchor: ReceiptAnchor | null;
};

export const UNHASHED_KEYS = ["receipt_hash", "anchor"] as const;

export const RECEIPTS_ROOT = "receipts";

/**
 * Canonical JSON: sorted keys, no insignificant whitespace, so identical
 * receipt content always hashes identically. scripts/verify.py implements
 * the same rule and the two are cross-checked by test/unit/receipt-hash.test.ts.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeReceiptHash(receipt: Receipt): string {
  return createHash("sha256").update(canonicalJson(receipt)).digest("hex");
}

export function signReceipt(receipt: Receipt, anchor: ReceiptAnchor | null = null): SignedReceipt {
  return { ...receipt, receipt_hash: computeReceiptHash(receipt), anchor };
}

export function writeReceipt(receipt: SignedReceipt): string {
  const dir = join(RECEIPTS_ROOT, receipt.model);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `epoch_${receipt.epoch}.json`);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
  return path;
}

export function readReceipt(model: string, epoch: number): SignedReceipt {
  return JSON.parse(
    readFileSync(join(RECEIPTS_ROOT, model, `epoch_${epoch}.json`), "utf-8"),
  ) as SignedReceipt;
}

export function listReceipts(model: string): SignedReceipt[] {
  const dir = join(RECEIPTS_ROOT, model);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("epoch_") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as SignedReceipt)
    .sort((a, b) => a.epoch - b.epoch);
}

/** Highest epoch number already recorded for a model, or 0 if none. */
export function latestEpoch(model: string): number {
  const receipts = listReceipts(model);
  return receipts.length === 0 ? 0 : receipts[receipts.length - 1]!.epoch;
}
