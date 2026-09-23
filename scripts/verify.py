#!/usr/bin/env python3
"""Verify VAULT-PILOT receipts.

Standalone: Python 3.9+, standard library only. No install step.

Checks, per receipt:
  1. receipt_hash matches a recomputed SHA-256 over the canonical receipt body
  2. the allocation chain is continuous (this epoch's pre == last epoch's post)
  3. every recorded allocation satisfies the policy caps
  4. yield_delta_bps matches the allocations and yields actually recorded
  5. onchain receipts carry transaction hashes; accounting receipts do not
  6. with --rpc: the receipt_hash really was published in the named Base
     Sepolia transaction, proving the decision predates its outcome

Usage:
  python3 scripts/verify.py --all
  python3 scripts/verify.py --all --rpc
  python3 scripts/verify.py --model base-a --epoch 3
  python3 scripts/verify.py --all --rpc https://sepolia.base.org
"""

import argparse
import hashlib
import json
import os
import sys

RECEIPTS_ROOT = os.environ.get("RECEIPTS_ROOT", "receipts")
POLICY_PATH = os.path.join("src", "config", "policy.yaml")


# Keys written after the hash is computed, therefore excluded from it.
# Must stay in sync with UNHASHED_KEYS in src/storage/receipts.ts.
UNHASHED_KEYS = ("receipt_hash", "anchor")


def canonical_json(value):
    """Sorted-key, whitespace-free JSON. Mirrors canonicalJson in src/storage/receipts.ts."""
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        items = (
            json.dumps(k, ensure_ascii=False) + ":" + canonical_json(value[k])
            for k in sorted(value.keys())
        )
        return "{" + ",".join(items) + "}"
    raise TypeError("unsupported type in receipt: %r" % type(value))


def compute_hash(receipt_body):
    return hashlib.sha256(canonical_json(receipt_body).encode("utf-8")).hexdigest()


def read_policy_caps(path=POLICY_PATH):
    """Minimal YAML scalar reader for the two caps we enforce.

    Avoids a PyYAML dependency so judges can run this with a bare interpreter.
    """
    caps = {"max_allocation_per_vault": None, "gross_cap": None}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.split("#", 1)[0].strip()
                if ":" not in line:
                    continue
                key, _, raw = line.partition(":")
                key = key.strip()
                if key in caps and raw.strip():
                    try:
                        caps[key] = float(raw.strip())
                    except ValueError:
                        pass
    except OSError:
        return None
    if caps["max_allocation_per_vault"] is None or caps["gross_cap"] is None:
        return None
    return caps


def weighted_yield_bps(allocation, yields_bps):
    return sum(frac * yields_bps.get(vault, 0) for vault, frac in allocation.items())


def check_receipt(receipt, previous, caps):
    """Return a list of failure strings; empty means the receipt verified."""
    failures = []

    body = {k: v for k, v in receipt.items() if k not in UNHASHED_KEYS}
    recomputed = compute_hash(body)
    if recomputed != receipt.get("receipt_hash"):
        failures.append(
            "hash mismatch: stored %s, recomputed %s"
            % (str(receipt.get("receipt_hash"))[:16], recomputed[:16])
        )

    if previous is not None and receipt["pre_allocation"] != previous["post_allocation"]:
        failures.append(
            "allocation chain broken: pre_allocation != epoch %d post_allocation"
            % previous["epoch"]
        )

    if caps is not None:
        for label in ("pre_allocation", "post_allocation"):
            allocation = receipt.get(label, {})
            gross = sum(allocation.values())
            for vault, frac in allocation.items():
                if frac < 0:
                    failures.append("%s: %s is negative (%s)" % (label, vault, frac))
                if frac > caps["max_allocation_per_vault"] + 1e-9:
                    failures.append(
                        "%s: %s=%.4f exceeds max_allocation_per_vault %.4f"
                        % (label, vault, frac, caps["max_allocation_per_vault"])
                    )
            if gross > caps["gross_cap"] + 1e-9:
                failures.append(
                    "%s: gross %.4f exceeds gross_cap %.4f" % (label, gross, caps["gross_cap"])
                )

    yields_bps = receipt.get("observed_yields_bps", {})
    expected_pre = weighted_yield_bps(receipt["pre_allocation"], yields_bps)
    expected_post = weighted_yield_bps(receipt["post_allocation"], yields_bps)
    if abs(expected_pre - receipt.get("pre_weighted_yield_bps", 0)) > 1e-6:
        failures.append(
            "pre_weighted_yield_bps %.6f does not match allocation (%.6f)"
            % (receipt.get("pre_weighted_yield_bps", 0), expected_pre)
        )
    if abs(expected_post - receipt.get("post_weighted_yield_bps", 0)) > 1e-6:
        failures.append(
            "post_weighted_yield_bps %.6f does not match allocation (%.6f)"
            % (receipt.get("post_weighted_yield_bps", 0), expected_post)
        )
    if abs((expected_post - expected_pre) - receipt.get("yield_delta_bps", 0)) > 1e-6:
        failures.append("yield_delta_bps does not match post minus pre")

    mode = receipt.get("settlement_mode")
    tx_hashes = receipt.get("tx_hashes", [])
    if mode == "onchain" and not tx_hashes:
        failures.append("settlement_mode=onchain but tx_hashes is empty")
    if mode == "accounting" and tx_hashes:
        failures.append("settlement_mode=accounting but tx_hashes is non-empty")

    if not receipt.get("policy_checks_passed", False):
        if receipt["pre_allocation"] != receipt["post_allocation"]:
            failures.append("guards failed but the allocation still changed")

    return failures


def rpc_call(rpc_url, method, params):
    """Minimal JSON-RPC over urllib so this script stays dependency-free."""
    import urllib.request

    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    request = urllib.request.Request(
        rpc_url,
        data=payload.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # Public RPC endpoints reject urllib's default User-Agent.
            "User-Agent": "vault-pilot-verify/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if "error" in body:
        raise RuntimeError(body["error"].get("message", "rpc error"))
    return body.get("result")


def check_anchor(receipt, rpc_url):
    """Confirm the receipt_hash was actually published onchain in the named tx."""
    anchor = receipt.get("anchor")
    if not anchor:
        return ["no onchain anchor recorded for this receipt"]

    tx_hash = anchor.get("tx_hash")
    try:
        tx = rpc_call(rpc_url, "eth_getTransactionByHash", [tx_hash])
    except Exception as exc:  # network/RPC problems are reported, not fatal
        return ["could not read anchor tx %s: %s" % (tx_hash, exc)]

    if tx is None:
        return ["anchor tx %s not found on chain" % tx_hash]

    onchain_payload = (tx.get("input") or "").lower()
    expected = ("0x" + str(receipt.get("receipt_hash", ""))).lower()
    if onchain_payload != expected:
        return [
            "onchain payload does not match receipt_hash (chain=%s, local=%s)"
            % (onchain_payload[:18], expected[:18])
        ]

    if tx.get("blockNumber") is None:
        return ["anchor tx %s is still pending" % tx_hash]

    return []


def load_model_receipts(model):
    directory = os.path.join(RECEIPTS_ROOT, model)
    if not os.path.isdir(directory):
        return []
    receipts = []
    for name in os.listdir(directory):
        if name.startswith("epoch_") and name.endswith(".json"):
            with open(os.path.join(directory, name), "r", encoding="utf-8") as fh:
                receipts.append(json.load(fh))
    receipts.sort(key=lambda r: r["epoch"])
    return receipts


def discover_models():
    if not os.path.isdir(RECEIPTS_ROOT):
        return []
    return sorted(
        d for d in os.listdir(RECEIPTS_ROOT) if os.path.isdir(os.path.join(RECEIPTS_ROOT, d))
    )


def main():
    parser = argparse.ArgumentParser(description="Verify VAULT-PILOT receipts.")
    parser.add_argument("--all", action="store_true", help="verify every model arm")
    parser.add_argument("--model", help="verify a single model arm id")
    parser.add_argument("--epoch", type=int, help="verify a single epoch of --model")
    parser.add_argument(
        "--rpc",
        nargs="?",
        const="https://sepolia.base.org",
        help="also verify each receipt's onchain anchor (default RPC: Base Sepolia)",
    )
    args = parser.parse_args()

    if not args.all and not args.model:
        parser.error("pass --all or --model MODEL_ID")

    caps = read_policy_caps()
    if caps is None:
        print("warning: could not read policy caps from %s; skipping cap checks\n" % POLICY_PATH)

    models = [args.model] if args.model else discover_models()
    if not models:
        print("No receipts found under %s/." % RECEIPTS_ROOT)
        return 1

    total = 0
    failed = 0

    for model in models:
        receipts = load_model_receipts(model)
        if args.epoch is not None:
            receipts = [r for r in receipts if r["epoch"] == args.epoch]
        if not receipts:
            print("%-18s no receipts" % model)
            continue

        print("%s" % model)
        previous = None
        for receipt in receipts:
            total += 1
            failures = check_receipt(receipt, previous, caps)
            if args.rpc:
                failures.extend(check_anchor(receipt, args.rpc))
            previous = receipt
            status = "PASS" if not failures else "FAIL"
            if failures:
                failed += 1
            anchor = receipt.get("anchor")
            anchor_label = (
                "anchored %s" % str(anchor.get("tx_hash"))[:14] if anchor else "not anchored"
            )
            print(
                "  epoch %-4d %s  yield_delta=%+8.2fbps  cost=$%.5f  %s  %s"
                % (
                    receipt["epoch"],
                    status,
                    receipt.get("yield_delta_bps", 0),
                    receipt.get("reasoning_cost_usd", 0),
                    receipt.get("settlement_mode", "?"),
                    anchor_label,
                )
            )
            for failure in failures:
                print("         - %s" % failure)
        print()

    print("%d receipt(s) checked, %d passed, %d failed." % (total, total - failed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
