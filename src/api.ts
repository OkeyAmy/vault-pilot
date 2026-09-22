import { createServer, type ServerResponse } from "node:http";
import { loadPolicy } from "./config/load-policy.js";
import { loadModelConfigs } from "./reasoning/model-configs.js";
import { listReceipts } from "./storage/receipts.js";
import { buildLeaderboard } from "./storage/leaderboard.js";
import { fetchCurrentYields } from "./vaults/yield-source.js";
import { anchoringEnabled } from "./storage/anchor.js";

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
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });
      return res.end();
    }

    try {
      switch (url.pathname) {
        case "/api/health":
          return json(res, 200, {
            ok: true,
            anchoring: anchoringEnabled(),
            time: new Date().toISOString(),
          });

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
