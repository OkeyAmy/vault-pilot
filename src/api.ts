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
import { startScheduler, type SchedulerHandle } from "./scheduler.js";
import { fetchModelCatalogue } from "./reasoning/model-catalogue.js";

const PORT = Number(process.env.API_PORT ?? 8787);

/**
 * The UI origin allowed to read this API. Defaults to the local dev server
 * rather than `*`, so a page on another origin cannot read agent state.
 */
const ALLOWED_ORIGIN = process.env.UI_ORIGIN ?? "http://localhost:5173";

/** Loopback unless deliberately exposed — this API drives a funded wallet. */
const HOST = process.env.API_HOST ?? "127.0.0.1";

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Vary": "Origin",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Read-only JSON API backing the UI. Deliberately has no mutating routes:
 * epochs are driven by the agent and the epoch runner, never by a page load.
 */
let scheduler: SchedulerHandle | null = null;

export function startReadApi(options: { withScheduler?: boolean } = {}) {
  if (options.withScheduler !== false && scheduler === null) {
    scheduler = startScheduler();
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      return res.end();
    }

    if (url.pathname === "/api/epoch/run") {
      if (req.method !== "POST") {
        return json(res, 405, { error: "use POST to start an epoch" });
      }
      // The scheduler is the normal driver; this endpoint only exists to
      // trigger an extra epoch on demand. It changes state, so it requires an
      // operator token — without one configured it stays closed rather than
      // open, so a page in another tab cannot drive this agent.
      const expected = process.env.OPERATOR_TOKEN;
      if (!expected) {
        return json(res, 403, {
          error:
            "Manual epoch triggering is disabled. Set OPERATOR_TOKEN to enable it; " +
            "the scheduler runs epochs automatically regardless.",
        });
      }
      if (req.headers.authorization !== `Bearer ${expected}`) {
        return json(res, 401, { error: "unauthorized" });
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
      return json(res, 200, {
        ...runState.get(),
        nextRunAt: scheduler?.nextRunAt() ?? null,
        intervalSeconds: Number(process.env.EPOCH_INTERVAL_SECONDS ?? 3600),
        schedulerOn: process.env.EPOCH_SCHEDULER !== "off",
      });
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

        case "/api/models": {
          const catalogue = await fetchModelCatalogue();
          const onlyFree = url.searchParams.get("free") === "true";
          const active = new Set(loadModelConfigs().map((m) => m.model));
          return json(res, 200, {
            active: [...active],
            models: (onlyFree ? catalogue.filter((m) => m.free) : catalogue).map((m) => ({
              ...m,
              inUse: active.has(m.id),
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

  server.listen(PORT, HOST, () => {
    console.log(`API listening on http://${HOST}:${PORT} (UI origin: ${ALLOWED_ORIGIN})`);
  });
  return server;
}

// Allow running the API standalone: `tsx --env-file=.env src/api.ts`
if (process.argv[1]?.endsWith("api.ts") || process.argv[1]?.endsWith("api.js")) {
  startReadApi();
}
