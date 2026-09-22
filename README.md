<p align="center">
  <img src="ui/public/logo.svg" alt="VAULT-PILOT" width="520" />
</p>

<p align="center">
  <b>A treasury agent that decides where money should sit, proves it decided before it knew the outcome,<br />
  and cannot be talked into breaking its own rules.</b>
</p>

<p align="center">
  SERV Hackathon Edition 01 · <b>RWA Vaults track</b> · partner: IXS Finance
</p>

---

## What this is, in plain terms

Say you hold $1,000,000 of a company's cash. You can park it in tokenized
treasury bills at 3.8%, or private credit at 5.2%. The rates move daily. Someone
has to keep deciding, and then justify each decision to whoever owns the money.

VAULT-PILOT does that on its own, every epoch, forever. It reads what the vaults
are actually paying right now, thinks through the trade-off, moves the
allocation, and writes down what it did and why.

The part that matters is the last one.

## The problem with an AI that manages money

Any agent can produce a log saying it made good decisions. You cannot tell,
afterwards, whether that log was written honestly at the time or assembled later
once the results were known. A convincing track record is easy to fake.

So every decision this agent makes gets fingerprinted, and the fingerprint is
published to a public blockchain **immediately, before anyone knows how the
decision turns out.**

That timestamp is the whole product. It converts *"trust our logs"* into
*"check the chain yourself"*:

```bash
python3 scripts/verify.py --all --rpc
```

Anyone can run that. It recomputes every fingerprint, fetches the matching
transaction, and compares them byte for byte. If a single number in a single
receipt were edited afterwards, the fingerprints would stop matching and the
check would fail loudly.

A log asks you to trust the author. A receipt anchored in a block does not.

---

## Try it

```bash
pnpm install
cp .env.example .env     # add one API key
pnpm dev                 # agent + interface, one command
```

Open <http://localhost:5173>. The agent starts thinking within seconds and keeps
going on its own. You are not required to press anything — the button exists
only if you want an extra run immediately.

| | |
|---|---|
| interface | <http://localhost:5173> |
| API | <http://127.0.0.1:8787> |
| how often it decides | `EPOCH_INTERVAL_SECONDS` (default 1 hour) |
| stop it deciding | `EPOCH_SCHEDULER=off` |

If something is missing — no API key, unfunded wallet — the interface says so
in plain language before you run anything, rather than failing halfway through.

---

## How one decision works

**1 · Look at what the vaults are actually paying.**
Not a cached table. The IXS vault is read straight off BNB Chain by asking the
contract what one share is currently worth. The others come from a public yield
index. Nothing here is invented — there is no synthetic data anywhere in this
project.

**2 · Think it through.**
Each model gets the same numbers and the same instructions, and must answer in
a fixed form: target allocation, rationale, confidence, risk score. It is asked
to weigh three things a naive optimiser would ignore:

- *credit risk* — private credit pays more because it can default
- *concentration* — a vault holding $656 total cannot absorb $200,000
- *uncertainty* — a new vault has no track record yet, and is told so honestly
  rather than being handed a fake 0%

**3 · Check it against the rules.**
The policy — no more than 40% in one vault, never more than fully invested,
don't churn for less than 15 basis points — is enforced twice. Once as
instructions to the model, and again in code afterwards.

The second one is the real one. **A model cannot argue with it.** High
confidence is not a credential. If a decision breaks a rule it is rejected, the
previous allocation stands, and the receipt records exactly what was attempted.
Failed attempts are kept, not hidden.

**4 · Write the receipt and anchor it.**
Before/after allocation, the yields it saw, its reasoning, what it cost, whether
the guards passed. Then the fingerprint goes onchain.

---

## Why several models at once

Four or five models run the same decision on the same data every epoch. Not to
crown a winner, but because *disagreement is the interesting signal.*

A recent epoch, same inputs:

> **nemotron-super** kept 20% in the new IXS vault and moved toward the
> higher-yielding private credit. Risk score 0.6.
>
> **nemotron-ultra** cut that vault to 5%, reasoning that *"TVL of only $656,
> implying >30% ownership concentration and zero observed yield history"* made
> it a liquidity risk regardless of the headline rate. Risk score 0.35.

Neither is obviously wrong. That is the point — you can see how differently
models weigh risk when the answer is not obvious, and every one of those
judgements is on the record.

The leaderboard ranks by yield captured, but shows cost per decision and
rule-compliance beside it. An agent that earns more by breaking rules more often
is not better, and the table refuses to hide that.

Adding models is a config line, not a code change. `/api/models` lists every
model the endpoint will actually serve.

---

## Honest about what is real

> **The capital is notional. The yields, the reasoning, the rule enforcement,
> and the timestamps are real.**

`TREASURY_EQUITY_USD` is a number, not a funded account. A receipt saying
`settlement_mode: "accounting"` means no tokens moved — it does **not** mean the
data was fake.

**Real settlement is available and works.** The IXS vault accepts deposits from
anyone — no permission, no KYC, verified directly against the contract:

```
maxDeposit(any address) = unlimited      deposits open
paused()                = false
```

So `pnpm settle deposit <amount>` performs a genuine ERC-4626 deposit. It is
deliberately **not** automatic: IXS publishes no testnet vault, so this is real
money on BNB Chain mainnet. The scheduler never settles. There is a per-transaction
ceiling. You opt in by setting a key, or it does not happen.

```bash
pnpm settle status            # position, balances, whether deposits are open
pnpm settle deposit 5         # real deposit
pnpm settle redeem 4.5        # real redemption
```

---

## What runs where

```
src/
  scheduler.ts        decides on its own clock; never overlaps runs
  epoch-runner.ts     one decision: read → reason → check → record → anchor
  vaults/
    ixs-source.ts     reads IXS vaults straight off BNB Chain
    ixs-settlement.ts real deposits and redemptions (opt-in)
    yield-source.ts   public index for the non-IXS vaults
  reasoning/
    guard-chain.ts    the rules a model cannot argue with
    policy-graph.ts   the decision contract every model must fill in
  storage/
    receipts.ts       fingerprinting
    anchor.ts         publishing fingerprints onchain
scripts/
  verify.py           the check anyone can run; no dependencies
  settle.ts           manual real settlement
ui/                   the interface
```

## Running the checks

```bash
pnpm test              # 54 tests
pnpm verify:onchain    # every receipt, against the chain
pnpm benchmark         # agent vs. an equal-split baseline
```

The fingerprinting is implemented twice — once in TypeScript to write receipts,
once in Python to verify them — and a test pins them to the same value so they
cannot silently drift apart.

---

## Where it stops

The agent reads IXS vaults for real and can settle into them for real. What it
does not do is settle *automatically*: that would mean an unattended process
moving real money on mainnet, which is not something to ship in a week.

Anchoring runs on a testnet, because the timestamp is what carries the meaning
and a testnet block proves precedence exactly as well as a mainnet one.
