import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../components/useScrollReveal";

function revealStyle(visible: boolean, delayMs = 0): CSSProperties {
  return visible ? { animationDelay: `${delayMs}ms` } : { opacity: 0 };
}

function revealClass(visible: boolean): string {
  return visible ? "reveal is-visible" : "reveal";
}

function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16 ${className}`}
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

function HeroEmblem() {
  return (
    <svg
      viewBox="0 0 320 420"
      role="img"
      aria-label="Anchored receipt emblem"
      className="h-auto w-[240px] md:w-[320px]"
    >
      {/* Receipt sheet with torn bottom edge */}
      <path
        d="M60 30 H260 V348 l-20 12 l-20 -12 l-20 12 l-20 -12 l-20 12 l-20 -12 l-20 12 l-20 -12 l-20 12 l-20 -12 l-20 12 Z"
        fill="#f7f6f2"
        stroke="#141414"
        strokeWidth="3"
      />
      {/* Header band */}
      <rect x="60" y="30" width="200" height="44" fill="#141414" />
      <text
        x="160"
        y="58"
        textAnchor="middle"
        fill="#f7f6f2"
        fontSize="15"
        fontWeight="700"
        letterSpacing="4"
        fontFamily="Inter, system-ui, sans-serif"
      >
        RECEIPT
      </text>
      {/* Ledger lines */}
      <g stroke="#141414" strokeWidth="2">
        <line x1="84" y1="104" x2="236" y2="104" />
        <line x1="84" y1="132" x2="200" y2="132" />
        <line x1="84" y1="160" x2="236" y2="160" />
        <line x1="84" y1="188" x2="180" y2="188" />
      </g>
      {/* Allocation blocks */}
      <g fill="#3b66d9">
        <rect x="84" y="214" width="86" height="18" />
        <rect x="174" y="214" width="42" height="18" opacity="0.55" />
        <rect x="220" y="214" width="16" height="18" opacity="0.3" />
      </g>
      {/* Hash line */}
      <text
        x="84"
        y="272"
        fill="#5f5c55"
        fontSize="13"
        fontFamily="ui-monospace, Menlo, monospace"
      >
        0x9f3c…a41e
      </text>
      <line x1="84" y1="288" x2="236" y2="288" stroke="#141414" strokeWidth="1" />
      {/* Anchor seal */}
      <circle
        cx="206"
        cy="316"
        r="34"
        fill="none"
        stroke="#3b66d9"
        strokeWidth="2.5"
        strokeDasharray="6 5"
      />
      <text
        x="206"
        y="312"
        textAnchor="middle"
        fill="#3b66d9"
        fontSize="9"
        fontWeight="700"
        letterSpacing="1"
        fontFamily="Inter, system-ui, sans-serif"
      >
        ANCHORED
      </text>
      <text
        x="206"
        y="326"
        textAnchor="middle"
        fill="#3b66d9"
        fontSize="9"
        fontWeight="700"
        letterSpacing="1"
        fontFamily="Inter, system-ui, sans-serif"
      >
        ONCHAIN
      </text>
      {/* Left metadata */}
      <text
        x="84"
        y="312"
        fill="#141414"
        fontSize="10"
        fontWeight="600"
        letterSpacing="2"
        fontFamily="Inter, system-ui, sans-serif"
      >
        EPOCH 001
      </text>
      <text
        x="84"
        y="330"
        fill="#5f5c55"
        fontSize="10"
        letterSpacing="1"
        fontFamily="Inter, system-ui, sans-serif"
        >
        POLICY PASS
      </text>
    </svg>
  );
}

const HERO_LABELS = [
  { text: "GUARD-CHAINED", className: "left-[5%] top-[16%] text-ink" },
  { text: "POLICY CAPPED", className: "right-[6%] top-[22%] text-muted" },
  { text: "SERV REASONING", className: "left-[8%] bottom-[26%] text-muted" },
  { text: "PROOF OF PRECEDENCE", className: "right-[7%] bottom-[20%] text-ink" },
];

function HeroSection() {
  return (
    <section
      className="paper-dot-grid relative flex min-h-[calc(100svh-72px)] items-center justify-center overflow-hidden px-6 py-14"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative flex w-full max-w-6xl flex-col items-center">
        <div className="relative flex min-h-[420px] w-full items-center justify-center md:min-h-[500px]">
          <HeroEmblem />
          {HERO_LABELS.map((label) => (
            <div
              key={label.text}
              className={`float-label absolute hidden max-w-[220px] text-xs font-semibold uppercase leading-tight tracking-[0.24em] md:block ${label.className}`}
            >
              {label.text}
            </div>
          ))}
        </div>

        <div className="mt-4 text-center">
          <p className="text-[11px] uppercase tracking-[0.4em] text-muted md:text-xs">
            notional capital · live yields · real timestamps
          </p>
          <h1 className="mt-4 text-3xl font-bold uppercase leading-tight tracking-[0.18em] text-ink md:text-5xl">
            Vault-Pilot
          </h1>
          <p className="mt-3 text-xs uppercase tracking-[0.3em] text-muted md:text-sm">
            Autonomous RWA Treasury Autopilot
          </p>
          <Link to="/tournament" className="btn btn-lg mt-9">
            Enter the arena
          </Link>
          <p className="mt-6 text-[10px] uppercase tracking-[0.3em] text-muted md:text-xs">
            live yields · serv reasoning · guard chain · onchain receipts
          </p>
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  const { ref, visible } = useScrollReveal();

  const lines = [
    "Treasuries hold idle stablecoins in a single vault.",
    "Better risk-adjusted yield sits one allocation away.",
    "Manual rebalancing is ops-heavy.",
    "Spreads move daily.",
    "There is no audit trail an LP or regulator would accept.",
  ];

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="max-w-3xl text-center">
        {lines.map((line, index) => (
          <p
            key={line}
            className={`text-base uppercase leading-relaxed tracking-[0.14em] text-ink md:text-xl ${revealClass(
              visible,
            )}`}
            style={revealStyle(visible, index * 130)}
          >
            {line}
          </p>
        ))}
        <p
          className={`mt-10 text-lg font-semibold uppercase tracking-[0.16em] text-accent md:text-3xl ${revealClass(
            visible,
          )}`}
          style={revealStyle(visible, lines.length * 130 + 200)}
        >
          What proof does your treasury have?
        </p>
      </div>
    </section>
  );
}

function SolutionSection() {
  const { ref, visible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className={`max-w-3xl ${revealClass(visible)}`} style={revealStyle(visible)}>
        <h2 className="text-2xl font-bold uppercase tracking-[0.18em] text-ink md:text-4xl">
          An autopilot, not a dashboard.
        </h2>
        <p className="mt-7 text-base leading-8 text-ink md:text-lg">
          Vault-Pilot is a headless agent on the OpenServ SDK. Every epoch it reads live vault
          yields, requests one structured decision per tournament arm through SERV, runs the result
          through a deterministic guard chain, writes a signed receipt, and publishes that receipt&apos;s
          hash onchain.
        </p>
        <p className="mt-4 text-base leading-8 text-muted md:text-lg">
          Installed infrastructure, not a screen. The guard chain enforces the policy in code — a
          model cannot talk its way past it. The onchain anchor adds proof of precedence: the
          timestamp shows the decision existed before its outcome was known.
        </p>
        <div className="mt-9 border border-rule bg-panel px-5 py-4">
          <p className="text-sm leading-7 text-ink md:text-base">
            The capital is <strong>notional</strong>. The yields, the reasoning, the policy
            enforcement, and the onchain timestamps are <strong>real</strong>.
          </p>
        </div>
        <div className="mt-10 border-t border-edge" />
      </div>
    </section>
  );
}

const STEPS = [
  {
    number: "01",
    title: "Read",
    copy: "Live vault APYs are pulled from the yield source each epoch. Every arm sees the identical snapshot, so differences in outcome are attributable to reasoning, not data.",
  },
  {
    number: "02",
    title: "Reason",
    copy: "One structured decision request per arm through SERV's reasoning layer, typed against a strict decision contract derived from the allocation policy.",
  },
  {
    number: "03",
    title: "Guard",
    copy: "A deterministic guard chain re-checks per-vault caps, gross cap, and minimum spread. Any violation holds the previous allocation and is recorded in the receipt.",
  },
  {
    number: "04",
    title: "Anchor",
    copy: "The receipt is hash-chained and its digest is published onchain as transaction calldata — proof the decision existed before its outcome was known.",
  },
];

function HowItWorksSection() {
  const { ref, visible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="mx-auto w-full max-w-6xl">
        <h2
          className={`text-center text-2xl font-bold uppercase tracking-[0.2em] text-ink md:text-4xl ${revealClass(
            visible,
          )}`}
          style={revealStyle(visible)}
        >
          How the loop works
        </h2>

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step, index) => (
            <article
              key={step.number}
              className={`border border-edge bg-panel p-6 transition-colors hover:border-rule ${revealClass(
                visible,
              )}`}
              style={revealStyle(visible, index * 120)}
            >
              <div className="text-4xl font-bold tracking-widest text-ink">{step.number}</div>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-ink">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted">{step.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const CHECKS = [
  { id: "HASH", copy: "The receipt hash recomputes byte-for-byte from the canonical body." },
  { id: "CHAIN", copy: "The allocation chain across epochs is continuous." },
  { id: "POLICY", copy: "Every allocation satisfies every policy cap." },
  { id: "SETTLE", copy: "Settlement mode agrees with the presence of transaction hashes." },
  { id: "PRECEDENCE", copy: "The digest really was published in the named onchain transaction." },
];

function VerifySection() {
  const { ref, visible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className={`mx-auto w-full max-w-4xl ${revealClass(visible)}`} style={revealStyle(visible)}>
        <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-ink md:text-4xl">
          Verify it yourself.
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted md:text-base">
          One command re-verifies every receipt, offline and against the chain. Each check proves a
          different property — none of them trust the agent&apos;s own word.
        </p>

        <div className="mt-8 border border-edge bg-panel">
          {CHECKS.map((check) => (
            <div
              key={check.id}
              className="grid grid-cols-[110px_1fr] gap-4 border-b border-edge px-5 py-3.5 last:border-b-0 md:grid-cols-[150px_1fr]"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                {check.id}
              </span>
              <span className="text-sm leading-6 text-muted">{check.copy}</span>
            </div>
          ))}
        </div>

        <div className="log-console mt-5 px-5 py-4 text-sm">
          <span className="text-muted">$ </span>
          <span>python3 scripts/verify.py --all --rpc</span>
        </div>

        <Link to="/receipts" className="btn mt-6">
          View receipts →
        </Link>
      </div>
    </section>
  );
}

function ArenaSection() {
  const { ref, visible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className={`max-w-3xl ${revealClass(visible)}`} style={revealStyle(visible)}>
        <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-ink md:text-4xl">
          The model arena.
        </h2>
        <p className="mt-6 text-base leading-8 text-ink md:text-lg">
          Several reasoning configurations — tournament arms — compete on identical yield data under
          the identical policy. Ranking is by cumulative yield delta, with cost per decision and
          policy-compliance rate alongside it.
        </p>
        <p className="mt-4 text-base leading-8 text-muted md:text-lg">
          One arm runs with SERV&apos;s shadow-agent validation loop enabled, isolating exactly what
          that loop contributes to allocation quality. The leaderboard is built from signed
          receipts, not self-reported scores.
        </p>
        <Link to="/tournament" className="btn btn-primary btn-lg mt-9">
          Enter the arena
        </Link>
      </div>
    </section>
  );
}

function FinalCtaSection() {
  const { ref, visible } = useScrollReveal();

  return (
    <section
      ref={ref}
      className="flex min-h-[calc(100svh-72px)] items-center justify-center px-6 py-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className={`max-w-3xl text-center ${revealClass(visible)}`} style={revealStyle(visible)}>
        <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-ink md:text-5xl">
          Run an epoch.
        </h2>
        <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link to="/tournament" className="btn btn-lg min-w-[240px]">
            Enter dashboard
          </Link>
          <Link to="/receipts" className="btn btn-lg min-w-[240px]">
            View receipts
          </Link>
        </div>
        <p className="mt-7 text-sm leading-7 text-muted">
          Live yields, real SERV reasoning calls, real guard enforcement, real onchain timestamps.
          The capital is notional — stated plainly, not implied.
        </p>
      </div>
    </section>
  );
}

function FooterSection() {
  return (
    <footer className="border-t border-rule px-6 py-8 text-center">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted md:text-xs">
        © 2026 Vault-Pilot · SERV Hackathon Edition 01 · RWA Vaults track
      </p>
      <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-muted/80 md:text-xs">
        notional capital · live yields · real timestamps
      </p>
    </footer>
  );
}

export function Home() {
  // Scope scroll-snapping to the home page only; app pages scroll freely.
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollSnapType = "y proximity";
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollSnapType = "";
      root.style.scrollBehavior = "";
    };
  }, []);

  return (
    <div>
      <HeroSection />
      <ProblemSection />
      <SolutionSection />
      <HowItWorksSection />
      <VerifySection />
      <ArenaSection />
      <FinalCtaSection />
      <FooterSection />
    </div>
  );
}
