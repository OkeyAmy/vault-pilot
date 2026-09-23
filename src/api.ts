import "./net-tuning.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
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

/**
 * API_PORT wins so a local run is never at the mercy of an inherited PORT —
 * the OpenServ agent claims that name too. PORT is honoured second because
 * platform hosts inject it and expect the service to bind exactly there.
 */
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

/**
 * The UI origin allowed to read this API when the interface is hosted
 * elsewhere. Same-origin deployments (the API serving ui/dist itself) are
 * always allowed without configuration.
 */
const ALLOWED_ORIGIN = process.env.UI_ORIGIN ?? "http://localhost:5173";

/** Loopback by default; set API_HOST=0.0.0.0 when deploying publicly. */
const HOST = process.env.API_HOST ?? "127.0.0.1";

/** Built interface served alongside the API when present. */
const UI_DIST = process.env.UI_DIST ?? join(process.cwd(), "ui", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/**
 * Same-origin requests (the browser's Origin matching this server's Host)
 * are always allowed — that is the deployed configuration. Cross-origin
 * reads fall back to the single configured UI_ORIGIN.
 */
function corsOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host === host) return origin;
    } catch {
      // fall through to the configured origin
    }
  }
  return ALLOWED_ORIGIN;
}

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": corsOrigin(req),
    "Vary": "Origin",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Serve the built UI with an SPA fallback so deep links work on reload. */
function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(UI_DIST)) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin(req),
    });
    res.end(
      "UI bundle not found. Build it with: pnpm --filter vault-pilot-ui build\n" +
        "(In local dev the interface runs separately at http://localhost:5173.)\n",
    );
    return;
  }

  const decoded = decodeURIComponent(pathname);
  const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(UI_DIST, safePath);
  if (!filePath.startsWith(UI_DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    // SPA fallback: client-side routes (e.g. /receipts/nex-pro/2) render index.html
    filePath = join(UI_DIST, "index.html");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end("not found");
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const stat = statSync(filePath);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(stat.size),
    "Access-Control-Allow-Origin": corsOrigin(req),
    // Hashed asset names can be cached hard; index.html must not be.
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
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
        "Access-Control-Allow-Origin": corsOrigin(req),
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      return res.end();
    }

    if (url.pathname === "/api/epoch/run") {
      if (req.method !== "POST") {
        return json(req, res, 405, { error: "use POST to start an epoch" });
      }
      // The scheduler is the normal driver; this endpoint only exists to
      // trigger an extra epoch on demand. It changes state, so it requires an
      // operator token — without one configured it stays closed rather than
      // open, so a page in another tab cannot drive this agent.
      const expected = process.env.OPERATOR_TOKEN;
      if (!expected) {
        return json(req, res, 403, {
          error:
            "Manual epoch triggering is disabled. Set OPERATOR_TOKEN to enable it; " +
            "the scheduler runs epochs automatically regardless.",
        });
      }
      if (req.headers.authorization !== `Bearer ${expected}`) {
        return json(req, res, 401, { error: "unauthorized" });
      }
      if (runState.isRunning()) {
        return json(req, res, 409, { error: "an epoch is already running" });
      }
      runState.start();
      // Respond immediately; the UI follows along via /api/epoch/status.
      void runTournamentEpoch((message, level, arm) => runState.step(message, level, arm))
        .then(() => runState.finish())
        .catch((err: Error) => {
          runState.step(err.message, "error");
          runState.fail(err.message);
        });
      return json(req, res, 202, { started: true });
    }

    if (url.pathname === "/api/epoch/status") {
      return json(req, res, 200, {
        ...runState.get(),
        nextRunAt: scheduler?.nextRunAt() ?? null,
        intervalSeconds: Number(process.env.EPOCH_INTERVAL_SECONDS ?? 3600),
        schedulerOn: process.env.EPOCH_SCHEDULER !== "off",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        switch (url.pathname) {
          case "/api/health":
            return json(req, res, 200, {
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

            return json(req, res, 200, {
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
            return json(req, res, 200, buildLeaderboard());

          case "/api/policy": {
            const policy = loadPolicy();
            return json(req, res, 200, {
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
            return json(req, res, 200, {
              active: [...active],
              models: (onlyFree ? catalogue.filter((m) => m.free) : catalogue).map((m) => ({
                ...m,
                inUse: active.has(m.id),
              })),
            });
          }

          case "/api/yields":
            return json(req, res, 200, await fetchCurrentYields(loadPolicy().vaults));

          case "/api/receipts": {
            const model = url.searchParams.get("model");
            const ids = model ? [model] : loadModelConfigs().map((m) => m.id);
            return json(req, res, 200, Object.fromEntries(ids.map((id) => [id, listReceipts(id)])));
          }

          default:
            return json(req, res, 404, { error: `no route for ${url.pathname}` });
        }
      } catch (err) {
        return json(req, res, 500, { error: (err as Error).message });
      }
    }

    // Everything else is the interface (or a deep link into it).
    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, url.pathname);
    }
    return json(req, res, 405, { error: "method not allowed" });
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
