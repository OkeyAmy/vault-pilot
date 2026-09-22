import { runTournamentEpoch } from "./epoch-runner.js";

const outcomes = await runTournamentEpoch();

if (outcomes.length === 0) {
  console.error("No epochs completed.");
  process.exit(1);
}

for (const o of outcomes) {
  const guard = o.guardPassed ? "guards ok" : "GUARDS FAILED — held previous allocation";
  console.log(
    `[${o.modelId}] epoch ${o.epoch}  ` +
      `${o.rebalanced ? "rebalanced" : "held"}  ` +
      `yield_delta=${o.yieldDeltaBps.toFixed(2)}bps  ${guard}  -> ${o.receiptPath}`,
  );
}
