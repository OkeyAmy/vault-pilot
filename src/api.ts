import { createServer, type ServerResponse } from "node:http";
import { loadPolicy } from "./config/load-policy.js";
import { loadModelConfigs } from "./reasoning/model-configs.js";
import { listReceipts } from "./storage/receipts.js";
import { buildLeaderboard } from "./storage/leaderboard.js";
import { fetchCurrentYields } from "./vaults/yield-source.js";
import { anchoringEnabled, anchorAddress, anchorBalanceWei } from "./storage/anchor.js";
import { runTournamentEpoch } from "./epoch-runner.js";
import { runState } from "./run-state.js";
import { servToolsSupported, resolvedBaseUrl } from "./reasoning/serv-client.js";

const PORT = Number(process.env.API_PORT ?? 8787);

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Read-only JSON API backing the UI. Deliberately has no mutating routes:
 * epochs are driven by the agent and the epoch runner, never by a page load.
 */
export function startReadApi() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (url.pathname === "/api/epoch/run") {
      if (req.method !== "POST") {
        return json(res, 405, { error: "use POST to start an epoch" });
      }
      if (runState.isRunning()) {
        return json(res, 409, { error: "an epoch is already running" });
      }
      runState.start();
      // Respond immediately; the UI follows along via /api/epoch/status.
      void runTournamentEpoch((message, level, arm) => runState.step(message, level, arm))
        .then(() => runState.finish())
        .catch((err: Error) => {
          runState.step(err.message, "error");
          runState.fail(err.message);
        });
      return json(res, 202, { started: true });
    }

    if (url.pathname === "/api/epoch/status") {
      return json(res, 200, runState.get());
    }

    try {
      switch (url.pathname) {
        case "/api/health":
          return json(res, 200, {
            ok: true,
            anchoring: anchoringEnabled(),
            time: new Date().toISOString(),
          });

        /**
         * What is configured and what is missing. The UI uses this to explain
         * exactly why a run would fail before the user triggers one.
         */
        case "/api/preflight": {
          const baseUrl = resolvedBaseUrl();
          const reasoningReady = Boolean(process.env.SERV_API_KEY);

          let anchorFunded: boolean | null = null;
          let anchorAddr: string | null = null;
          let anchorError: string | null = null;
          if (anchoringEnabled()) {
            try {
              anchorAddr = anchorAddress();
              anchorFunded = (await anchorBalanceWei()) > 0n;
            } catch (err) {
              anchorError = (err as Error).message;
            }
          }

          const blockers: string[] = [];
          if (!reasoningReady) {
            blockers.push("SERV_API_KEY is not set — no decisions can be requested.");
          }

          const warnings: string[] = [];
          if (!anchoringEnabled()) {
            warnings.push(
              "Anchoring is off (no ANCHOR_PRIVATE_KEY). Receipts will be written but not published onchain.",
            );
          } else if (anchorFunded === false) {
            warnings.push(
              `Anchoring wallet ${anchorAddr} has no gas. Fund it or epochs will fail at the anchoring step.`,
            );
          } else if (anchorError) {
            warnings.push(`Could not read anchoring wallet balance: ${anchorError}`);
          }

          return json(res, 200, {
            ready: blockers.length === 0,
            blockers,
            warnings,
            reasoning: {
              ready: reasoningReady,
              baseUrl,
              servToolsActive: servToolsSupported(baseUrl),
              arms: loadModelConfigs().map((m) => m.id),
            },
            anchoring: {
              enabled: anchoringEnabled(),
              address: anchorAddr,
              funded: anchorFunded,
              chainId: Number(process.env.ANCHOR_CHAIN_ID ?? 84532),
            },
          });
        }

        case "/api/leaderboard":
          return json(res, 200, buildLeaderboard());

        case "/api/policy": {
          const policy = loadPolicy();
          return json(res, 200, {
            ...policy,
            arms: loadModelConfigs().map((m) => ({
              id: m.id,
              name: m.name,
              model: m.model,
              shadow_agent: m.useShadowAgent,
            })),
          });
        }

        case "/api/yields":
          return json(res, 200, await fetchCurrentYields(loadPolicy().vaults));

        case "/api/receipts": {
          const model = url.searchParams.get("model");
          const ids = model ? [model] : loadModelConfigs().map((m) => m.id);
          return json(res, 200, Object.fromEntries(ids.map((id) => [id, listReceipts(id)])));
        }

        default:
          return json(res, 404, { error: `no route for ${url.pathname}` });
      }
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(PORT, () => {
    console.log(`read API listening on http://localhost:${PORT}`);
  });
  return server;
}

// Allow running the API standalone: `tsx --env-file=.env src/api.ts`
if (process.argv[1]?.endsWith("api.ts") || process.argv[1]?.endsWith("api.js")) {
  startReadApi();
}
