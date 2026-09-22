import { Agent, run } from "@openserv-labs/sdk";
import { z } from "zod";
import { loadPolicy } from "./config/load-policy.js";
import { loadModelConfigs } from "./reasoning/model-configs.js";
import { fetchCurrentYields } from "./vaults/yield-source.js";
import { runTournamentEpoch } from "./epoch-runner.js";
import { listReceipts } from "./storage/receipts.js";
import { buildLeaderboard } from "./storage/leaderboard.js";

const agent = new Agent({
  systemPrompt:
    "You are VAULT-PILOT, an autonomous treasury allocator for tokenized real-world-asset vaults. " +
    "You scan live vault yields, decide allocations under a fixed policy, and publish verifiable receipts.",
  apiKey: process.env.OPENSERV_API_KEY,
});

agent.addCapability({
  name: "scan_yields",
  description:
    "Fetch the current live APY and TVL for every vault in the treasury policy. Returns JSON.",
  inputSchema: z.object({}),
  async run() {
    const policy = loadPolicy();
    const yields = await fetchCurrentYields(policy.vaults);
    return JSON.stringify(yields, null, 2);
  },
});

agent.addCapability({
  name: "run_epoch",
  description:
    "Run one allocation epoch across every configured model arm against the same live yield " +
    "snapshot, applying the policy guard chain and writing a signed receipt per arm.",
  inputSchema: z.object({}),
  async run() {
    const outcomes = await runTournamentEpoch();
    return JSON.stringify(outcomes, null, 2);
  },
});

agent.addCapability({
  name: "get_receipts",
  description:
    "Return the signed receipt log for a given model arm id, or for all arms if none is given.",
  inputSchema: z.object({
    modelId: z.string().optional().describe("Model arm id, e.g. base-a"),
  }),
  async run({ args }) {
    const ids = args.modelId ? [args.modelId] : loadModelConfigs().map((m) => m.id);
    return JSON.stringify(
      Object.fromEntries(ids.map((id) => [id, listReceipts(id)])),
      null,
      2,
    );
  },
});

agent.addCapability({
  name: "get_leaderboard",
  description:
    "Rank every model arm by cumulative yield captured, reasoning cost, and policy compliance.",
  inputSchema: z.object({}),
  async run() {
    return JSON.stringify(buildLeaderboard(), null, 2);
  },
});

const { stop } = await run(agent);

process.on("SIGTERM", () => void stop());
