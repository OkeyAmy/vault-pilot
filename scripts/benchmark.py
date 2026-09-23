#!/usr/bin/env python3
"""Compare recorded agent allocations against a static equal-weight baseline.

Scores each tournament arm using the yields that arm actually observed, so the
comparison is drawn from the same data the agent saw at decision time. No
re-fetching, no hindsight.

Standalone: Python 3.9+, standard library only.

Usage:
  python3 scripts/benchmark.py
  python3 scripts/benchmark.py --equity 1000000 --epochs-per-year 365
"""

import argparse
import json
import os

RECEIPTS_ROOT = os.environ.get("RECEIPTS_ROOT", "receipts")


def weighted_yield_bps(allocation, yields_bps):
    return sum(frac * yields_bps.get(vault, 0) for vault, frac in allocation.items())


def load_receipts(model):
    directory = os.path.join(RECEIPTS_ROOT, model)
    receipts = []
    for name in sorted(os.listdir(directory)):
        if name.startswith("epoch_") and name.endswith(".json"):
            with open(os.path.join(directory, name), "r", encoding="utf-8") as fh:
                receipts.append(json.load(fh))
    return sorted(receipts, key=lambda r: r["epoch"])


def discover_models():
    if not os.path.isdir(RECEIPTS_ROOT):
        return []
    return sorted(
        d for d in os.listdir(RECEIPTS_ROOT) if os.path.isdir(os.path.join(RECEIPTS_ROOT, d))
    )


def score(receipts, equity, epochs_per_year):
    """Compound the agent's chosen allocation and an equal-weight baseline."""
    agent_equity = equity
    static_equity = equity
    reasoning_cost = 0.0

    for receipt in receipts:
        yields_bps = receipt.get("observed_yields_bps", {})
        vaults = list(yields_bps.keys())
        if not vaults:
            continue
        static_allocation = {v: 1.0 / len(vaults) for v in vaults}

        agent_rate = weighted_yield_bps(receipt["post_allocation"], yields_bps) / 10_000
        static_rate = weighted_yield_bps(static_allocation, yields_bps) / 10_000

        agent_equity *= 1 + agent_rate / epochs_per_year
        static_equity *= 1 + static_rate / epochs_per_year
        reasoning_cost += receipt.get("reasoning_cost_usd", 0.0)

    delta_usd = agent_equity - static_equity
    return {
        "epochs": len(receipts),
        "agent_equity_usd": round(agent_equity, 2),
        "static_equity_usd": round(static_equity, 2),
        "delta_usd": round(delta_usd, 2),
        "delta_bps": round((delta_usd / equity) * 10_000, 4),
        "reasoning_cost_usd": round(reasoning_cost, 6),
        "net_of_cost_usd": round(delta_usd - reasoning_cost, 2),
        "guard_failures": sum(1 for r in receipts if not r.get("policy_checks_passed", False)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--equity", type=float, default=1_000_000.0)
    parser.add_argument("--epochs-per-year", type=float, default=365.0)
    parser.add_argument("--out", default="benchmark_results.json")
    args = parser.parse_args()

    models = discover_models()
    if not models:
        print("No receipts found under %s/. Run `pnpm epoch` first." % RECEIPTS_ROOT)
        return 1

    print(
        "Agent allocation vs. equal-weight baseline, scored on the yields each "
        "epoch actually observed.\n"
    )
    print(
        "%-16s %-7s %-16s %-16s %-12s %-11s %s"
        % ("arm", "epochs", "agent", "static", "delta", "cost", "net")
    )
    print("-" * 94)

    results = {}
    for model in models:
        receipts = load_receipts(model)
        if not receipts:
            continue
        summary = score(receipts, args.equity, args.epochs_per_year)
        results[model] = summary
        print(
            "%-16s %-7d $%-15.2f $%-15.2f %+10.3fbps $%-10.5f $%+.2f"
            % (
                model,
                summary["epochs"],
                summary["agent_equity_usd"],
                summary["static_equity_usd"],
                summary["delta_bps"],
                summary["reasoning_cost_usd"],
                summary["net_of_cost_usd"],
            )
        )

    if not results:
        print("No receipts to score.")
        return 1

    best = max(results.items(), key=lambda kv: kv[1]["delta_bps"])
    print("\nBest arm by yield delta: %s (%+.3fbps)" % (best[0], best[1]["delta_bps"]))

    total_epochs = sum(r["epochs"] for r in results.values())
    if total_epochs < len(results) * 5:
        print(
            "\nNote: %d epoch(s) across %d arm(s) is a small sample. Let the "
            "epoch runner accumulate more before quoting these numbers."
            % (total_epochs, len(results))
        )

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "equity_usd": args.equity,
                "epochs_per_year": args.epochs_per_year,
                "models": results,
            },
            fh,
            indent=2,
        )
    print("\nWrote %s" % args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
