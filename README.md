<p align="center">
  <img src="ui/public/logo.svg" alt="VAULT-PILOT" width="520" />
</p>

<p align="center">
  <b>An autonomous RWA treasury autopilot that reasons through SERV,<br />
  is stopped by guards it cannot charm, and prints a receipt for everything.</b>
</p>

<p align="center">
  SERV Hackathon Edition 01 · <b>RWA Vaults track</b> · partner: IXS Finance<br />
  <i>live yields · structured reasoning · guard-chained · anchored onchain</i>
</p>

---

## The line we are not allowed to weasel out of

> **The capital is notional. The yields, the reasoning, the policy enforcement, and the onchain timestamps are real.**

`TREASURY_EQUITY_USD` (default $1,000,000) is a number, not a funded wallet.
Everything the agent reasons over is live: vault APYs are fetched at decision
time, every decision is a real model call, the guard chain really rejects
violations, and every receipt hash is really published onchain. A receipt with
`settlement_mode: "accounting"` means no token transfer occurred — it does not
mean simulated data. There is no synthetic data anywhere in this project.

---

## Preflight — 90 seconds to airborne

```bash
pnpm install
cp .env.example .env          # set SERV_API_KEY  (console.openserv.ai/settings/keys)

pnpm dev                      # API + interface + epoch scheduler, one command
```

| | |
|---|---|
| interface | <http://localhost:5173> |
| API | <http://127.0.0.1:8787> |
| first epoch | seconds after boot (`EPOCH_START_DELAY_SECONDS`, default 5) |
| cadence | every `EPOCH_INTERVAL_SECONDS` (default 3600, floor 30) |
| kill switch | `EPOCH_SCHEDULER=off` — API stays up, epochs stop |

The scheduler is the autopilot: it never overlaps runs (epoch numbers come from
receipts on disk), and a failed epoch logs and retries next tick rather than
dying. Prefer one shot? `pnpm epoch`. Prefer a button? The interface's **run
epoch** streams every step through `POST /api/epoch/run`.

Before anything runs, `/api/preflight` tells you what is and is not
configured — a missing key is a blocker, an unfunded anchoring wallet a
warning. You never have to guess why a run would fail.

---

## The loop

One epoch, start to finish. Nothing in this diagram is illustrative — it is
the code path every arm travels:

```
                    ┌──────────────────── ONE EPOCH ────────────────────┐
                    │                                                  │
  live yields ──────▶  REASON          GUARD           RECORD          │  ANCHOR
  · IXS ERC-4626    │  SERV × 4 arms   deterministic   SHA-256         │  zero-value
    read onchain    │  forced          re-check:       receipt per     │  self-send,
    on BNB Chain    │  submit_         caps, NaN,      arm: pre/post,  │  hash as
  · BUIDL, USDY,    │  decision        unknown         rationale,      │  calldata
    Maple, Centrif. │  tool call       vaults,         cost, guards    │  on Base
    via public      │                  negative                    ────▶  Sepolia
    index           │                  numbers                        │
                    └──────────────────────────────────────────────────┘
```

5\. The receipt hash goes onchain as transaction calldata. The block
timestamp proves the decision existed *before* its outcome was known.

### How a decision is actually made

Each arm, each epoch:

1. **Fetch** — APY/TVL for every vault in the policy. IXS vaults are read
   straight from the ERC-4626 contract (`convertToAssets(1 share)`); yield is
   derived from share-price history and honestly reported as
   `insufficient_history` until 30 minutes of samples exist — an unproven vault
   says *unknown*, never a fabricated number.
2. **Reason** — one call to SERV's OpenAI-compatible endpoint at temperature
   0.1, forced through a `submit_decision` tool call so every provider returns
   the same typed shape. The model must weigh credit risk, liquidity, and
   uncertainty — and state in its rationale what it chose *not* to do.
3. **Guard** — the deterministic chain re-checks everything. Any violation
   holds the previous allocation.
4. **Record** — a receipt captures before/after allocations, observed yields,
   rationale, confidence, risk score, token cost, and the guard verdict.
   Rejected proposals are kept, not hidden: `policy_violations` shows exactly
   what the model tried.
5. **Anchor** — the receipt's SHA-256 is published onchain.

### The flight plan is code, twice

`src/config/policy.yaml` is the contract: 40% per-vault cap, 1.0 gross cap,
15bps minimum rebalance spread, a pinned vault set (IXS Agentic Vault, BUIDL,
USDY, Maple USDC, Centrifuge USDS).

It is enforced **twice** — once as instructions to the model, again by
`runGuardChain()` in code. The second one is authoritative:

- unknown vaults rejected
- negative or non-finite allocations rejected
- over-cap and over-gross rejected
- anything below the spread threshold isn't worth moving for

**A model cannot talk its way past it.** Confidence 0.99 is not a credential.

> Vault labels and pool metadata come from a third-party feed and are
> interpolated into the prompt that controls capital allocation. That is a
> real injection vector, so `serv_prompt_guard` runs on every call — and even
> a successful injection still hits the guard chain on the way out.

---

## The arena — which reasoning config allocates best?

Arms are environment, not code:

```
TOURNAMENT_MODELS=id:model:shadow:inPriceUSD:outPriceUSD,...
```

Default roster:

| arm | model | shadow loop | what it tests |
|---|---|---|---|
| `base-a` | `gpt-5.4-mini` | off | control |
| `shadow-a` | `gpt-5.4-mini` | **on** | what `serv_shadow_agent` alone contributes |
| `base-b` | `claude-haiku-4.5` | off | cross-vendor reasoning |
| `base-c` | `gemini-3.5-flash` | off | cost vs. quality frontier |

Fairness rules:

- every arm sees the **identical yield snapshot** each epoch — differences are
  attributable to reasoning, not data;
- `base-a` vs `shadow-a` isolates SERV's validation loop against itself on the
  same model, so the arena measures a feature, not a brand;
- ranking is **cumulative yield delta**, shown beside **cost per decision** and
  **policy-compliance rate** — an arm that earns more by failing guards more
  often is not obviously better, and the leaderboard refuses to hide that.

`SERV_BASE_URL` and `TOURNAMENT_MODELS` are both env-driven, so any
OpenAI-compatible endpoint works. `serv_*` tools are SERV's convention (SERV
strips them before the model sees them); other gateways would forward them as
real tools, so they are only sent when the endpoint actually implements them
(auto-detected, force with `SERV_TOOLS=on|off`). Receipts record
`shadow_agent: false` when the loop never ran — no claiming validation that
did not happen.

---

## A log proves nothing. A receipt proves precedence.

Anyone can generate a self-consistent hash chain after the fact. What they
cannot do is put a hash in a block *before the future is known*.

So each receipt's SHA-256 is written onchain as the calldata of a zero-value
self-send — cheap, contract-free, and permanent. The block timestamp is the
claim: **this decision existed before its outcome did.** That is the
difference between a log and evidence.

The split of duties:

- **local files** hold the full receipt (rationale, allocations, costs) and
  serve the API, UI, and leaderboard;
- **the chain** holds only the digest — the commitment you verify against;
- **`verify.py`** closes the loop: recompute the local hash, fetch the anchor
  transaction, compare calldata byte-for-byte.

The anchoring wallet only ever signs zero-value testnet transactions. It never
holds or moves treasury capital — keep it separate from any key that does.

```bash
pnpm wallet:new       # throwaway key; add it to .env
# fund the printed address from a Base Sepolia faucet
pnpm wallet:status    # balance + chain confirmed
pnpm epoch            # receipts now carry an onchain anchor
```

---

## Landing the claim — verify it yourself in 60 seconds

```bash
python3 scripts/verify.py --all --rpc
```

Standalone Python 3.9+, standard library only — no install step. Six seals
per receipt, each one a way the record could have lied:

| # | seal | what it kills |
|---|---|---|
| 1 | SHA-256 recomputes over canonical JSON | edited receipts |
| 2 | allocation chain continuous (`preₙ = postₙ₋₁`) | history rewritten between epochs |
| 3 | policy caps hold on every allocation | over-cap moves smuggled in |
| 4 | yield delta matches allocations × observed yields | inflated scoreboards |
| 5 | settlement mode agrees with tx-hash presence | claimed onchain fills that never happened |
| 6 | `--rpc`: hash really is the calldata of the named tx | anchors that were never anchored |

Then open any receipt's `explorer_url` and compare. **They are the same
bytes.**

The verifier is deliberately adversarial — it has been tested against tampered
receipts and catches, among others, an over-cap allocation re-hashed to look
internally valid. The TypeScript writer and the Python verifier share one
pinned regression test, so they cannot silently drift apart.

---

## Billing the flight

Basis points on assets under management. A $10M treasury at 20bp is $20k/yr;
ten such treasuries is $200k ARR. No seats, no per-user licensing — it scales
with TVL, which is the same thing the vault operator wants.

The claim gets a number, not an adjective:

```bash
python3 scripts/benchmark.py
```

Each arm is compounded against an equal-weight static baseline using **the
yields each epoch actually observed** — no re-fetching, no hindsight — then
netted against reasoning cost. Output lands in `benchmark_results.json`.
With one epoch the delta is near zero; that is honesty, not a bug. Let the
scheduler accumulate before quoting figures.

---

## Logbook

```
src/
  agent.ts            OpenServ agent + capabilities (scan, run, receipts, board)
  api.ts              JSON API for the UI + embedded epoch scheduler
  scheduler.ts        the autopilot: cadence, overlap guard, failure tolerance
  epoch-runner.ts     yields -> decide -> guard -> receipt -> anchor
  run-state.ts        live run progress streamed to the interface
  vaults/             live yield source: IXS onchain + public index
  reasoning/          policy graph, guard chain, arms, SERV client
  storage/            canonical receipts, anchoring, portfolio math, leaderboard
  config/policy.yaml  the flight plan: vault set and caps
scripts/
  dev.mjs             one command: API + interface, interleaved logs
  verify.py           judge-facing verification (offline + --rpc)
  benchmark.py        agent vs. static baseline on observed yields
  wallet.ts           anchoring key tooling
  run-epochs.sh       external loop, if you prefer the scheduler off
ui/                   paper-minimal interface: home, tournament, receipts, policy
```

```bash
pnpm test     # 54 unit tests — hash contract, guards, portfolio math, arms
pnpm build    # type-checks everything
pnpm lint
```

---

## Where it lands next

**Onchain settlement via IXS Agent Rail.** IXS exposes ERC-4626 vault
operations over MCP, and the decision output here is already shaped as an
ERC-4626 allocation, so execution is a wiring step rather than a redesign.
The documented agent-wallet flow authenticates through interactive browser
OAuth, which is incompatible with unattended operation; this build therefore
stops at the allocation of record. Headless credentials are the missing
piece, not the integration.

**Longer soak.** Yield deltas over a handful of epochs are noise. The claim
gets stronger with weeks of anchored receipts, not with better wording.

---

<p align="center">
  <img src="ui/public/logo.svg" alt="VAULT-PILOT" width="360" /><br />
  <sub>notional capital · live yields · real timestamps · verify: <code>python3 scripts/verify.py --all --rpc</code></sub>
</p>
