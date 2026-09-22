# VAULT-PILOT

**A headless agent that allocates treasury capital across tokenized real-world-asset vaults, reasons through every rebalance with SERV Reasoning, and publishes tamper-evident receipts anchored onchain.**

Built for SERV Hackathon Edition 01 — **RWA Vaults track**.

---

## What is and is not real

> **The capital is notional. The yields, the reasoning, the policy enforcement, and the onchain timestamps are real.**

`TREASURY_EQUITY_USD` (default $1,000,000) is a number, not a funded wallet. Everything the agent reasons over is live: vault APYs come from a public RWA yield feed at decision time, every decision is a real model call, the guard chain really rejects violations, and every receipt hash is really published onchain.

A receipt with `settlement_mode: "accounting"` means **no token transfer occurred** — it does not mean simulated data. There is no synthetic data anywhere in this project.

---

## Why the receipts are worth anything

A hash chain you generate and verify yourself proves internal consistency and nothing more. Anyone could regenerate the whole log after the fact.

What makes these receipts evidence is **anchoring**: each receipt's SHA-256 hash is written onchain as transaction calldata. The block timestamp proves the decision existed *before* its outcome was known. That is the difference between a log and a record.

`verify.py` checks six things per receipt:

1. the hash recomputes from the receipt body
2. the allocation chain is continuous — this epoch's `pre` equals last epoch's `post`
3. every allocation satisfies the policy caps
4. the reported yield delta matches the allocations and yields actually recorded
5. settlement mode agrees with the presence of transaction hashes
6. with `--rpc`: the hash really was published in the named transaction

The verifier is deliberately adversarial. It has been tested against tampered receipts and catches, among others, an over-cap allocation that was re-hashed to look internally valid.

---

## Quickstart

```bash
pnpm install
cp .env.example .env
# set SERV_API_KEY in .env  (console.openserv.ai/settings/keys)

pnpm epoch                        # run one tournament epoch
python3 scripts/verify.py --all   # verify every receipt
```

To see it in a browser:

```bash
pnpm api     # read API on :8787
pnpm ui      # interface on :5173
```

### Enabling onchain anchoring

```bash
pnpm wallet:new       # generates a throwaway anchoring key; add it to .env
# fund the printed address from a Base Sepolia faucet
pnpm wallet:status    # confirms balance and chain
pnpm epoch            # receipts now carry an onchain anchor
```

The anchoring wallet only ever signs zero-value testnet transactions whose calldata is a receipt hash. It never holds or moves treasury capital — keep it separate from any key that does.

---

## Verifying this as a judge

```bash
python3 scripts/verify.py --all --rpc
```

Standalone Python 3.9+, standard library only — no install step. It prints a pass/fail line per receipt and exits non-zero if any check fails.

Then open any receipt's `explorer_url` and compare the transaction's calldata to that receipt's `receipt_hash`. They are the same bytes.

---

## How a decision is made

Each epoch, for each tournament arm:

1. **Fetch** live APY and TVL for every vault in the policy.
2. **Reason** — one call to SERV's OpenAI-compatible endpoint, forced to answer through a `submit_decision` tool call so every model returns the same typed shape regardless of provider.
3. **Guard** — a deterministic chain re-checks per-vault caps, gross cap, negative and non-finite allocations, and unknown vaults. Any violation holds the previous allocation.
4. **Record** — a receipt captures before/after allocations, observed yields, rationale, confidence, risk score, token cost, and the guard outcome.
5. **Anchor** — the receipt hash is published onchain.

The policy is enforced **twice**: once as instructions to the model, and again in code. The second one is authoritative. A model cannot talk its way past it, and a rejected proposal is still recorded — `policy_violations` shows exactly what it tried.

### Prompt injection is a real vector here

Vault labels and pool metadata come from a third-party feed and are interpolated into a prompt that controls capital allocation. `serv_prompt_guard` is therefore enabled on every call. The guard chain is the backstop: even a successful injection cannot produce an allocation that violates policy.

---

## The tournament

Arms are configured in `TOURNAMENT_MODELS`, not hardcoded:

```
id:model:shadow:inPriceUSD:outPriceUSD
```

Every arm sees an identical yield snapshot each epoch, so differences in outcome are attributable to reasoning rather than to data. The default roster pairs one model against itself with `serv_shadow_agent` enabled — SERV's validation loop — which isolates what that loop actually contributes rather than confounding it with a model change.

Ranking is by cumulative yield delta, shown alongside cost per decision and policy-compliance rate. A strategy that earns more while failing guards more often is not obviously better, and the leaderboard shows both.

---

## Revenue model

Basis points on assets under management. A $10M treasury at 20bp is $20k/yr; ten such treasuries is $200k ARR. No seats and no per-user licensing — it scales with TVL, which is the same thing the vault operator wants.

`python3 scripts/benchmark.py` scores each arm against an equal-weight static baseline using the yields each epoch actually observed, and writes `benchmark_results.json`.

---

## Layout

```
src/
  agent.ts            OpenServ agent + capabilities
  epoch-runner.ts     yields -> decide -> guard -> receipt -> anchor
  api.ts              read-only JSON API for the UI
  vaults/             live yield source
  reasoning/          policy graph, guard chain, arms, SERV client
  storage/            receipts, anchoring, portfolio math, leaderboard
  config/policy.yaml  vault set and caps
scripts/
  verify.py           judge-facing verification
  benchmark.py        agent vs. static baseline
  wallet.ts           anchoring key tooling
  run-epochs.sh       recurring epoch runner
ui/                   interface (tournament, receipts, policy)
```

---

## Tests

```bash
pnpm test    # 54 unit tests
pnpm build   # type-check everything
```

The receipt hash is pinned by a regression test and independently reproduced by `verify.py`, so the TypeScript writer and the Python verifier cannot silently drift apart.

---

## Roadmap

**Onchain settlement via IXS Agent Rail.** IXS exposes ERC-4626 vault operations over MCP, and the decision output here is already shaped as an ERC-4626 allocation, so execution is a wiring step rather than a redesign. The documented agent-wallet flow authenticates through interactive browser OAuth, which is incompatible with unattended operation; this build therefore stops at the allocation of record. Headless credentials are the missing piece, not the integration.

**Longer soak.** Yield deltas over a handful of epochs are noise. The claim gets stronger with weeks of anchored receipts, not with a better-worded README.
