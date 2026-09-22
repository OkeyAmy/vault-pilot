# VAULT-PILOT Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Work top to bottom; each task ends at a commit.

**Goal:** Ship a headless RWA treasury autopilot that allocates a notional treasury across real tokenized-RWA vaults using SERV Reasoning, publishes tamper-evident receipts anchored onchain, and runs a live model tournament — demoable and submitted by 2026-09-28 00:00 UTC.

**Architecture:** A TypeScript agent on the OpenServ SDK. Each epoch pulls live vault APYs, sends one structured decision request per tournament arm through SERV's OpenAI-compatible endpoint (forced `submit_decision` tool call), validates the result through a deterministic guard chain, writes a SHA-256-signed receipt, and publishes that hash to a testnet as proof-of-precedence. A standalone Python script re-verifies every receipt, offline and onchain. A forked React UI renders the tournament, receipts, and policy.

**Tech Stack:** TypeScript (strict, ESM), `@openserv-labs/sdk` v2, zod, viem, js-yaml, vitest, pnpm. Python 3.9+ stdlib for verification. Vite + React 19 + React Router 7 + Tailwind 4 for the UI.

**Hackathon:** SERV Hackathon Edition 01, **RWA Vaults track** (partner: IXS Finance). Judged on creativity, user-readiness, revenue potential.

---

## Ground Truth (verified 2026-09-22 — do not re-derive)

These were checked against live docs and live endpoints. Several contradict `../idea.md`, which was written from assumptions.

| Fact | Value |
|---|---|
| SERV inference base URL | `https://inference-api.openserv.ai/v1` (OpenAI-compatible); Anthropic-compatible at `/v1/messages` |
| SERV auth | `Authorization: Bearer $SERV_API_KEY`, key from console.openserv.ai/settings/keys |
| **SERV hard requirement** | Every request needs a `system` message, `instructions` field, or developer message, or it is **rejected** |
| Real SERV model ids | `gpt-5.4-mini`, `claude-haiku-4.5`, `gemini-3.5-flash`, `gpt-5.4`, `claude-opus-5`, … |
| **Not real** | `gpt-4o`, `claude-3.5-sonnet`, `llama-3.1-405b`, `serv-reasoning-v2` — idea.md's four arms. There is **no SERV-native model**; SERV is the layer in front of every model |
| SERV tools | `serv_prompt_guard`, `serv_shadow_agent`, `serv_disable_content_filter`. SERV strips any `serv_`-prefixed tool before the model sees it |
| Agent SDK | `new Agent({systemPrompt, apiKey})`, `addCapability({name, description, inputSchema, run})`, `await run(agent)` opens a local tunnel — no deploy needed for dev |
| `OPENSERV_API_KEY` | **Different key** from `SERV_API_KEY` (platform hosting vs. inference) |
| Live yield source | `yields.llama.fi/pools` (17,274 pools) and `/chart/{poolId}` (180d history). No API key. Note: `/pools` has **no `category` field** — filter by `project` |
| IXS Agent Rail | An **MCP server** at `https://wallet-mcp.fd.xyz`. Vaults are ERC-4626, **permissionless, no protocol-layer KYC** |
| IXS vault | `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82` on **BNB Chain** (not Base), FDUSD |
| **MCP auth gap** | Docs show interactive browser OAuth via District Pass; **no documented headless token**. Therefore MCP is NOT on the critical path — see Task 9 |
| Faucet testnets | Base Sepolia (84532), BSC Testnet (97), Ethereum Sepolia (11155111), Arbitrum Sepolia (421614) |
| Base Sepolia RPC | `https://sepolia.base.org` works, but **rejects urllib's default User-Agent** — must send one |

**Submission requirements:** enable data collection at console.openserv.ai/settings/organization; public X post tagging `@openservai` with name, concept, images, repo/demo links; then fill the submission form. New, working, demoable by Sept 28.

---

## Honest Framing (use this wording; do not overclaim)

The demo runs with **notional capital**: `TREASURY_EQUITY_USD` (default $1,000,000) is a number, not a funded wallet. Everything else is real — live vault APYs, real SERV reasoning calls, real guard enforcement, real onchain timestamps.

State it exactly once, plainly, in the README and the demo video:

> The capital is notional. The yields, the reasoning, the policy enforcement, and the onchain timestamps are real.

A receipt with `settlement_mode: "accounting"` and a populated `anchor` is the expected demo state. `accounting` means no token transfer occurred — **it does not mean simulated data.**

---

## Current State

Already built and verified:

- `src/vaults/` — live yield source (`fetchCurrentYields`, `fetchHistoricalYields`)
- `src/reasoning/` — policy graph + decision schema, guard chain, env-driven model configs, SERV client
- `src/storage/` — receipts (canonical JSON + SHA-256), portfolio math, leaderboard, onchain anchor
- `src/epoch-runner.ts`, `src/tournament.ts`, `src/agent.ts`
- `scripts/verify.py` — offline + `--rpc` onchain verification
- `test/unit/guard-chain.test.ts` — 12 tests, passing
- `pnpm build` clean; TS↔Python hash parity confirmed byte-for-byte; verify.py confirmed to catch 6 classes of tampering

Not yet done: Tasks 1–12 below.

---

## File Structure

```
vault-pilot/
├── src/
│   ├── agent.ts                    # OpenServ agent + capabilities
│   ├── epoch-runner.ts             # one epoch: yields → decide → guard → receipt → anchor
│   ├── tournament.ts               # CLI entry for one tournament epoch
│   ├── vaults/
│   │   ├── types.ts                # VaultDef, VaultYield, Allocation
│   │   └── yield-source.ts         # live + historical APY fetch
│   ├── reasoning/
│   │   ├── policy-graph.ts         # Policy, DecisionSchema, prompt builders
│   │   ├── guard-chain.ts          # deterministic policy enforcement
│   │   ├── model-configs.ts        # env-driven tournament arms
│   │   └── serv-client.ts          # SERV chat-completions + forced tool call
│   ├── storage/
│   │   ├── receipts.ts             # canonical JSON, hashing, read/write
│   │   ├── anchor.ts               # onchain hash publication
│   │   ├── portfolio.ts            # weighted yield, allocation equality
│   │   └── leaderboard.ts          # tournament ranking
│   └── config/
│       ├── policy.yaml             # vault set + caps
│       └── load-policy.ts          # zod-validated loader
├── scripts/
│   ├── verify.py                   # judge-facing verification CLI
│   └── benchmark.py                # agent vs. static baseline on real history
├── test/unit/
│   ├── guard-chain.test.ts         # DONE
│   ├── receipt-hash.test.ts        # Task 1
│   ├── portfolio.test.ts           # Task 2
│   └── model-configs.test.ts       # Task 3
├── ui/                             # Task 10 (forked, rebranded)
├── plan.md                         # this file
└── README.md                       # Task 11
```

---

## Task 1: Lock receipt-hash stability

A receipt hash that changes when an unrelated field is added silently invalidates every prior receipt. Pin the contract.

**Files:** Create `test/unit/receipt-hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { canonicalJson, computeReceiptHash, signReceipt, type Receipt } from "../../src/storage/receipts.js";

const receipt: Receipt = {
  epoch: 1, model: "base-a", timestamp: "2026-09-22T19:00:00.000Z",
  settlement_mode: "accounting",
  pre_allocation: { buidl: 0.25, usdy: 0.25 },
  post_allocation: { usdy: 0.4, buidl: 0.4 },
  observed_yields_bps: { buidl: 377, usdy: 359 },
  yield_source: "https://yields.llama.fi",
  reasoning_model: "gpt-5.4-mini", shadow_agent: false, response_id: "resp_x",
  tx_hashes: [], reasoning_cost_usd: 0.0012345,
  prompt_tokens: 810, completion_tokens: 140,
  pre_weighted_yield_bps: 184, post_weighted_yield_bps: 294.4,
  yield_delta_bps: 110.4,
  policy_checks_passed: true, policy_violations: [],
  rationale: "unicode ✓ and \"quotes\"", confidence: 0.72, risk_score: 0.35,
};

describe("canonicalJson", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("produces the pinned digest for a known receipt", () => {
    // Regression pin: if this changes, every previously issued receipt is invalidated.
    expect(computeReceiptHash(receipt)).toBe(
      "REPLACE_WITH_ACTUAL_DIGEST",
    );
  });
});

describe("signReceipt", () => {
  it("excludes receipt_hash and anchor from the hashed body", () => {
    const withAnchor = signReceipt(receipt, {
      tx_hash: "0xabc", block_number: 1, chain_id: 84532, explorer_url: "https://x/tx/0xabc",
    });
    const withoutAnchor = signReceipt(receipt, null);
    expect(withAnchor.receipt_hash).toBe(withoutAnchor.receipt_hash);
  });
});
```

- [ ] **Step 2: Run it and read the real digest out of the failure**

Run: `pnpm vitest run test/unit/receipt-hash.test.ts`
Expected: FAIL, reporting the actual digest. Paste that value over `REPLACE_WITH_ACTUAL_DIGEST`.

- [ ] **Step 3: Re-run to confirm green**

Run: `pnpm vitest run test/unit/receipt-hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add test/unit/receipt-hash.test.ts
git commit -m "test: pin receipt hash contract"
```

---

## Task 2: Test portfolio math

`allocationsEqual` decides whether a rebalance is recorded; a bug here corrupts the leaderboard.

**Files:** Create `test/unit/portfolio.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from "vitest";
import {
  allocationsEqual, weightedYieldBps, staticBaselineAllocation, accrueEquity,
} from "../../src/storage/portfolio.js";

describe("allocationsEqual", () => {
  it("ignores key order", () => {
    expect(allocationsEqual({ a: 0.5, b: 0.5 }, { b: 0.5, a: 0.5 })).toBe(true);
  });
  it("treats an absent key as zero", () => {
    expect(allocationsEqual({ a: 0.5 }, { a: 0.5, b: 0 })).toBe(true);
  });
  it("detects a real change", () => {
    expect(allocationsEqual({ a: 0.5 }, { a: 0.6 })).toBe(false);
  });
  it("tolerates float noise below 1e-9", () => {
    expect(allocationsEqual({ a: 0.1 + 0.2 }, { a: 0.3 })).toBe(true);
  });
});

describe("weightedYieldBps", () => {
  it("weights each vault by its fraction", () => {
    expect(weightedYieldBps({ a: 0.5, b: 0.5 }, { a: 400, b: 600 })).toBe(500);
  });
  it("treats a missing yield as zero", () => {
    expect(weightedYieldBps({ a: 1.0 }, {})).toBe(0);
  });
});

describe("staticBaselineAllocation", () => {
  it("splits equally and sums to one", () => {
    const alloc = staticBaselineAllocation(["a", "b", "c", "d"]);
    expect(alloc.a).toBe(0.25);
    expect(Object.values(alloc).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe("accrueEquity", () => {
  it("accrues one day of a 365bps annual yield", () => {
    const result = accrueEquity({
      equityUsd: 1_000_000, allocation: { a: 1.0 },
      vaultYieldsBps: { a: 365 }, epochsPerYear: 365,
    });
    expect(result).toBeCloseTo(1_000_100, 2);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm vitest run test/unit/portfolio.test.ts`
Expected: PASS (8 tests). If `accrueEquity` fails, check the epoch-rate division, not the test.

- [ ] **Step 3: Commit**

```bash
git add test/unit/portfolio.test.ts
git commit -m "test: cover portfolio math"
```

---

## Task 3: Test model-config parsing

`TOURNAMENT_MODELS` is user-editable; a malformed entry must fail loudly at startup, not mid-epoch.

**Files:** Create `test/unit/model-configs.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { loadModelConfigs, estimateReasoningCostUsd } from "../../src/reasoning/model-configs.js";

afterEach(() => { delete process.env.TOURNAMENT_MODELS; });

describe("loadModelConfigs", () => {
  it("parses a single arm", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:0:1.00:6.00";
    const [arm] = loadModelConfigs();
    expect(arm).toMatchObject({ id: "a", model: "gpt-5.4-mini", useShadowAgent: false });
  });

  it("marks the shadow flag", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:1:1.00:6.00";
    expect(loadModelConfigs()[0]!.useShadowAgent).toBe(true);
  });

  it("falls back to defaults when unset", () => {
    expect(loadModelConfigs().length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a wrong field count", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:0";
    expect(() => loadModelConfigs()).toThrow(/5 colon-separated/);
  });

  it("rejects a bad shadow flag", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:yes:1.00:6.00";
    expect(() => loadModelConfigs()).toThrow(/shadow flag must be 0 or 1/);
  });

  it("rejects duplicate ids", () => {
    process.env.TOURNAMENT_MODELS = "a:m:0:1:6,a:n:0:1:6";
    expect(() => loadModelConfigs()).toThrow(/duplicate ids/);
  });
});

describe("estimateReasoningCostUsd", () => {
  it("prices input and output separately", () => {
    const cfg = {
      id: "a", name: "a", model: "m", useShadowAgent: false,
      pricePerMillionInputUsd: 1, pricePerMillionOutputUsd: 6,
    };
    expect(estimateReasoningCostUsd(cfg, 1_000_000, 1_000_000)).toBeCloseTo(7, 9);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm vitest run test/unit/model-configs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add test/unit/model-configs.test.ts
git commit -m "test: cover tournament arm parsing"
```

---

## Task 4: Make one real SERV call (**blocking — do this before Task 5**)

`requestDecision` has never executed against the live API. Two assumptions are unverified and both change the design if wrong:

1. Does a forced `tool_choice` naming `submit_decision` coexist with `serv_`-prefixed tools in the same `tools` array?
2. Does `serv_shadow_agent` work alongside a forced tool choice — or does the `shadow-a` arm have to be dropped?

- [ ] **Step 1: Put the key in place**

```bash
cp .env.example .env
# edit .env: set SERV_API_KEY
```

- [ ] **Step 2: Probe the endpoint directly, with both tools present**

```bash
set -a && source .env && set +a
curl -sS https://inference-api.openserv.ai/v1/chat/completions \
  -H "Authorization: Bearer $SERV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-5.4-mini",
    "messages":[
      {"role":"system","content":"Call submit_decision exactly once."},
      {"role":"user","content":"{\"epoch\":1,\"current_allocation\":{\"buidl\":1.0},\"live_vault_data\":{\"buidl\":{\"apy_bps\":377},\"usdy\":{\"apy_bps\":359}}}"}
    ],
    "tools":[
      {"type":"function","function":{"name":"submit_decision","description":"Submit the decision.","parameters":{"type":"object","properties":{"should_rebalance":{"type":"boolean"}},"required":["should_rebalance"]}}},
      {"type":"function","function":{"name":"serv_prompt_guard","parameters":{}}},
      {"type":"function","function":{"name":"serv_shadow_agent","parameters":{}}}
    ],
    "tool_choice":{"type":"function","function":{"name":"submit_decision"}}
  }' | head -60
```

Expected: HTTP 200 with `choices[0].message.tool_calls[0].function.name == "submit_decision"`.

- [ ] **Step 3: Act on the result**

- **200 + correct tool call** → no change; continue.
- **Error naming `serv_shadow_agent`** → remove the shadow tool from `tools` in `src/reasoning/serv-client.ts` and instead set the shadow arm's distinction another way (e.g. a second validation call); OR drop `shadow-a` from `TOURNAMENT_MODELS` and run 3 arms. Record the decision in README.
- **Error naming `serv_prompt_guard`** → set `DISABLE_PROMPT_GUARD=true` and note it.
- **`tool_choice` unsupported** → drop `tool_choice`, keep the tool definition, and add a retry that re-prompts when `tool_calls` is absent.

- [ ] **Step 4: Run one epoch end to end**

```bash
pnpm epoch
```

Expected: one receipt per arm under `receipts/<arm-id>/epoch_1.json`, each with a populated `rationale` and `response_id`.

- [ ] **Step 5: Verify what was just produced**

```bash
python3 scripts/verify.py --all
```

Expected: every receipt PASS; exit code 0.

- [ ] **Step 6: Commit any client changes**

```bash
git add -A src/reasoning/ && git commit -m "fix: align SERV client with live API behavior"
```

---

## Task 5: Benchmark against a static baseline on real history

The revenue claim ("+Nbps vs. doing nothing") needs a number derived from real data, not an assertion.

**Files:** Create `scripts/benchmark.py`

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Compare recorded agent allocations against a static equal-weight baseline.

Uses the yields each receipt actually observed, so the comparison is drawn
from the same data the agent saw. Python 3.9+, stdlib only.

Usage:
  python3 scripts/benchmark.py
  python3 scripts/benchmark.py --equity 1000000 --epochs-per-year 365
"""

import argparse
import json
import os

RECEIPTS_ROOT = "receipts"


def weighted(allocation, yields_bps):
    return sum(f * yields_bps.get(v, 0) for v, f in allocation.items())


def load(model):
    d = os.path.join(RECEIPTS_ROOT, model)
    out = []
    for name in sorted(os.listdir(d)):
        if name.startswith("epoch_") and name.endswith(".json"):
            with open(os.path.join(d, name), encoding="utf-8") as fh:
                out.append(json.load(fh))
    return sorted(out, key=lambda r: r["epoch"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--equity", type=float, default=1_000_000.0)
    ap.add_argument("--epochs-per-year", type=float, default=365.0)
    args = ap.parse_args()

    if not os.path.isdir(RECEIPTS_ROOT):
        print("No receipts/ directory.")
        return 1

    results = {}
    for model in sorted(os.listdir(RECEIPTS_ROOT)):
        if not os.path.isdir(os.path.join(RECEIPTS_ROOT, model)):
            continue
        receipts = load(model)
        if not receipts:
            continue

        agent_equity = args.equity
        static_equity = args.equity
        cost = 0.0

        for r in receipts:
            ys = r["observed_yields_bps"]
            vaults = list(ys.keys())
            static_alloc = {v: 1.0 / len(vaults) for v in vaults} if vaults else {}
            agent_equity *= 1 + (weighted(r["post_allocation"], ys) / 10_000) / args.epochs_per_year
            static_equity *= 1 + (weighted(static_alloc, ys) / 10_000) / args.epochs_per_year
            cost += r.get("reasoning_cost_usd", 0.0)

        delta_usd = agent_equity - static_equity
        results[model] = {
            "epochs": len(receipts),
            "agent_equity_usd": round(agent_equity, 2),
            "static_equity_usd": round(static_equity, 2),
            "delta_usd": round(delta_usd, 2),
            "delta_bps": round((delta_usd / args.equity) * 10_000, 2),
            "reasoning_cost_usd": round(cost, 6),
            "net_of_cost_usd": round(delta_usd - cost, 2),
        }
        print(
            "%-16s epochs=%-4d agent=$%-14.2f static=$%-14.2f delta=%+8.2fbps  cost=$%.4f  net=$%+.2f"
            % (
                model, len(receipts), agent_equity, static_equity,
                results[model]["delta_bps"], cost, results[model]["net_of_cost_usd"],
            )
        )

    with open("benchmark_results.json", "w", encoding="utf-8") as fh:
        json.dump({"equity_usd": args.equity, "models": results}, fh, indent=2)
    print("\nWrote benchmark_results.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run it**

Run: `python3 scripts/benchmark.py`
Expected: one line per arm plus `benchmark_results.json`. With only 1 epoch the delta is near zero — that is correct, not a bug.

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark.py && git commit -m "feat: add static-baseline benchmark"
```

---

## Task 6: Fund and enable onchain anchoring

- [ ] **Step 1: Generate a throwaway anchoring key**

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('ANCHOR_PRIVATE_KEY='+k);console.log('address: '+privateKeyToAccount(k).address)"
```

This key only ever signs zero-value testnet transactions. Put it in `.env` (gitignored). Never reuse a key that holds real funds.

- [ ] **Step 2: Fund it**

Claim Base Sepolia gas for the printed address from the Finance District faucet (`developers.fd.xyz/overview/developer-tools/faucet`) or any Base Sepolia faucet.

- [ ] **Step 3: Confirm the balance is non-zero**

```bash
set -a && source .env && set +a
node --input-type=module -e "
import {anchorBalanceWei, anchorAddress} from './dist/src/storage/anchor.js';
console.log(anchorAddress(), await anchorBalanceWei(), 'wei');
"
```

Expected: a non-zero wei balance. If zero, the faucet has not landed yet — wait and retry.

- [ ] **Step 4: Run an anchored epoch**

```bash
pnpm epoch
```

Expected: each log line ends with an anchor tx hash; each receipt has a populated `anchor` block.

- [ ] **Step 5: Verify onchain**

```bash
python3 scripts/verify.py --all --rpc
```

Expected: every receipt PASS including the anchor check. Open one `explorer_url` in a browser and confirm the calldata equals `0x` + `receipt_hash`.

- [ ] **Step 6: Commit**

```bash
git add receipts && git commit -m "chore: first anchored epoch"
```

---

## Task 7: Schedule recurring epochs

Receipts are only persuasive in volume, and the anchor timestamps must be genuinely spread over time — that is the whole point of proof-of-precedence. Start this early and let it accumulate while you build the UI.

**Files:** Create `scripts/run-epochs.sh`

- [ ] **Step 1: Write the loop**

```bash
#!/usr/bin/env bash
# Runs one tournament epoch every INTERVAL_SECONDS (default 1h).
# Keeps going if a single epoch fails.
set -u
INTERVAL="${INTERVAL_SECONDS:-3600}"
cd "$(dirname "$0")/.."
while true; do
  echo "=== epoch at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  pnpm epoch || echo "epoch failed, continuing"
  sleep "$INTERVAL"
done
```

- [ ] **Step 2: Make it executable and start it**

```bash
chmod +x scripts/run-epochs.sh
nohup ./scripts/run-epochs.sh > epochs.log 2>&1 &
echo $! > epochs.pid
```

- [ ] **Step 3: Confirm it is producing receipts**

```bash
sleep 60 && tail -20 epochs.log && ls receipts/*/
```

- [ ] **Step 4: Commit**

```bash
git add scripts/run-epochs.sh && git commit -m "feat: add recurring epoch runner"
```

Stop it later with `kill $(cat epochs.pid)`.

---

## Task 8: Serve the read API for the UI

The UI needs JSON over HTTP. Add read-only endpoints to the existing agent process rather than standing up a second service.

**Files:** Create `src/api.ts`; Modify `src/agent.ts`

- [ ] **Step 1: Write the server**

```typescript
import { createServer } from "node:http";
import { loadPolicy } from "./config/load-policy.js";
import { loadModelConfigs } from "./reasoning/model-configs.js";
import { listReceipts } from "./storage/receipts.js";
import { buildLeaderboard } from "./storage/leaderboard.js";
import { fetchCurrentYields } from "./vaults/yield-source.js";

const PORT = Number(process.env.API_PORT ?? 8787);

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function startReadApi() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    try {
      if (url.pathname === "/api/leaderboard") return json(res, 200, buildLeaderboard());
      if (url.pathname === "/api/policy") return json(res, 200, loadPolicy());
      if (url.pathname === "/api/yields") {
        return json(res, 200, await fetchCurrentYields(loadPolicy().vaults));
      }
      if (url.pathname === "/api/receipts") {
        const model = url.searchParams.get("model");
        const ids = model ? [model] : loadModelConfigs().map((m) => m.id);
        return json(res, 200, Object.fromEntries(ids.map((id) => [id, listReceipts(id)])));
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  });
  server.listen(PORT, () => console.log(`read API on http://localhost:${PORT}`));
  return server;
}
```

- [ ] **Step 2: Start it from the agent**

In `src/agent.ts`, add the import and call it before `run(agent)`:

```typescript
import { startReadApi } from "./api.js";
startReadApi();
```

- [ ] **Step 3: Verify each endpoint**

```bash
pnpm build && node dist/src/api.js &
curl -s localhost:8787/api/leaderboard | head -20
curl -s localhost:8787/api/policy | head -20
curl -s localhost:8787/api/receipts | head -20
```

Expected: JSON from each; 404 on an unknown path.

- [ ] **Step 4: Commit**

```bash
git add src/api.ts src/agent.ts && git commit -m "feat: add read API for UI"
```

---

## Task 9: IXS MCP integration (**time-boxed to 2 hours — abandon if auth blocks**)

This is the RWA Vaults track's partner integration, so it is worth real effort — but the docs show only interactive browser OAuth, with no documented headless token. Do **not** let it block the submission.

- [ ] **Step 1: Determine whether headless auth exists**

Read `https://developers.fd.xyz/agent-wallet/ai-integration/mcp-server.md` and `https://developers.fd.xyz/agent-wallet/ai-integration/cli.md`. Look specifically for an API key, a stored refresh token, or an `fdx` CLI login that persists credentials to disk.

- [ ] **Step 2: Branch on the answer**

**If a durable credential exists** — wire it in `src/agent.ts` via the SDK's native MCP support:

```typescript
const agent = new Agent({
  systemPrompt: "...",
  apiKey: process.env.OPENSERV_API_KEY,
  mcpServers: {
    financeDistrict: {
      transport: "http",
      url: "https://wallet-mcp.fd.xyz",
      autoRegisterTools: true,
    },
  },
});
```

Each MCP tool then appears as `mcp_financeDistrict_<toolName>`. Use a read-only tool first (balance or vault state) and surface it as a `get_vault_state` capability. Do **not** move capital.

**If auth is interactive-only** — stop. Record in README under "Roadmap":

> IXS Agent Rail exposes vault operations over MCP. VAULT-PILOT's decision output is already shaped as an ERC-4626 allocation, so execution is a wiring step once headless agent-wallet credentials are available; the current build authenticates interactively only, which is incompatible with unattended operation.

That is an honest, informed statement about a real constraint, and it is worth more than a broken integration.

- [ ] **Step 3: Commit whichever outcome**

```bash
git add -A && git commit -m "feat: evaluate IXS MCP integration"
```

---

## Task 10: Fork and rebrand the UI

**Source:** `../vibe4trading/vibe4trading-frontend` (Vite + React 19 + React Router 7 + Tailwind 4).

**The fork must retain no trace of its origin** — no names, abbreviations, branding, assets, or i18n strings.

- [ ] **Step 1: Copy without git history or build artifacts**

```bash
cd /home/okey/Desktop/Projects/vault/vault-pilot
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .vscode \
  ../vibe4trading/vibe4trading-frontend/ ui/
```

- [ ] **Step 2: Delete routes with no counterpart here**

```bash
cd ui
rm -rf src/app/live src/app/tours src/app/contact src/app/runs/\[runId\]/watch
rm -rf src/i18n src/app/arena/submissions
rm -f public/v4t*.png public/v4t*.jpg ../v4t.jpg 2>/dev/null
```

- [ ] **Step 3: Find every trace of the source project**

```bash
grep -ril -e vibe4trading -e v4t -e "vibe 4 trading" . --exclude-dir=node_modules || echo "none in contents"
find . -iname "*vibe4trading*" -o -iname "*v4t*" | grep -v node_modules || echo "none in filenames"
```

- [ ] **Step 4: Clear every hit**

Rewrite each file the grep found. Package name becomes `vault-pilot-ui`. Titles, headers, nav labels, and meta tags become VAULT-PILOT. Remove i18n wiring and inline the English strings — a two-language setup is dead weight here. Delete any leftover logo asset rather than renaming it.

- [ ] **Step 5: Re-run both searches until each prints "none"**

```bash
grep -ril -e vibe4trading -e v4t . --exclude-dir=node_modules || echo "none in contents"
find . -iname "*vibe4trading*" -o -iname "*v4t*" | grep -v node_modules || echo "none in filenames"
```

Do not proceed while either still returns a hit.

- [ ] **Step 6: Point the UI at the read API**

```bash
cat > .env.local <<'EOF'
VITE_API_BASE_URL=http://localhost:8787
EOF
```

- [ ] **Step 7: Remap the pages**

| Route | Becomes | Data |
|---|---|---|
| `/` | Live tournament standings | `GET /api/leaderboard` |
| `/leaderboard` | Same, ranked by cumulative yield delta | `GET /api/leaderboard` |
| `/runs` | Receipt log across all arms | `GET /api/receipts` |
| `/runs/:id` | One receipt: allocations, rationale, guards, anchor link | `GET /api/receipts?model=` |
| `/admin/models` | Tournament arm config (read-only) | `GET /api/policy` |

Every receipt view must link `anchor.explorer_url` — that link is the proof, and it is the single most important element on the page.

- [ ] **Step 8: Run it**

```bash
pnpm install && pnpm dev
```

Open `http://localhost:5173`, confirm real data renders and no source-project name appears anywhere in the UI or page source.

- [ ] **Step 9: Commit**

```bash
cd .. && git add ui && git commit -m "feat: add VAULT-PILOT UI"
```

---

## Task 11: README

**Files:** Create `README.md`

- [ ] **Step 1: Write it, covering exactly these sections**

1. One-line pitch and the RWA Vaults track.
2. **The honest-framing sentence from the top of this plan, verbatim.**
3. Quickstart: `pnpm install`, `cp .env.example .env`, set `SERV_API_KEY`, `pnpm epoch`, `python3 scripts/verify.py --all`.
4. **How a judge verifies in under a minute** — `python3 scripts/verify.py --all --rpc`, what each check proves, and one explorer link to click.
5. What the guard chain enforces and why a model cannot override it.
6. Tournament arms, and what `serv_shadow_agent` / `serv_prompt_guard` contribute.
7. Revenue model: basis points on AUM; the benchmark number from `benchmark_results.json`.
8. Roadmap, including the Task 9 MCP outcome.

- [ ] **Step 2: Follow your own quickstart on a clean checkout**

Any step that does not work as written is a bug in the README.

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: add README"
```

---

## Task 12: Submit

- [ ] **Step 1: Confirm eligibility** — data collection enabled at console.openserv.ai/settings/organization. Without this the entry is disqualified regardless of quality.

- [ ] **Step 2: Full verification pass**

```bash
pnpm build && pnpm test && python3 scripts/verify.py --all --rpc && python3 scripts/benchmark.py
```

All four must succeed.

- [ ] **Step 3: Record the demo (~90s)** — policy and vault set; one live epoch running; a receipt with its reasoning; `verify.py --all --rpc` passing on screen; the explorer link resolving; the leaderboard. Say the honest-framing sentence out loud while the receipt is visible.

- [ ] **Step 4: Push the repo publicly** with `.env` absent and `.env.example` present.

```bash
git status --porcelain && grep -r "SERV_API_KEY=sk" . --exclude-dir=node_modules --exclude-dir=.git || echo "no leaked keys"
```

- [ ] **Step 5: Post to X** tagging `@openservai` — name, concept, images (leaderboard + a verified receipt), repo link, demo video. Mention IXS Finance for the track.

- [ ] **Step 6: Fill the submission form.** Posting alone is not a submission.

---

## Cut List (in order, if time runs short)

1. Task 9 (MCP) — already time-boxed; cut first.
2. Task 10 Steps 7–8 — ship fewer pages rather than a broken UI. The leaderboard alone is enough if the CLI verification works.
3. Task 5 (benchmark) — weakens the revenue claim but nothing else.

**Never cut:** Tasks 4, 6, 11, 12. A working SERV call, anchored receipts, a README a judge can follow, and an actually-filed submission are the entry.
