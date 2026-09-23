#!/usr/bin/env node
/**
 * Production entry point: one process serves the built interface, the read
 * API, and the autonomous epoch scheduler. This is what a deploy runs.
 *
 *   pnpm build:all   # once (or on every deploy)
 *   pnpm start       # API + UI + scheduler on one port
 *
 * Set API_HOST=0.0.0.0 in .env so the public internet can reach it.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * A checkout keeps its configuration in .env. A hosted deploy has no such
 * file — the platform injects the same values as real environment variables
 * — so the file is used when present and its absence is only fatal if the
 * environment is empty too.
 */
const envFile = join(root, ".env");
const hasEnvFile = existsSync(envFile);

if (!hasEnvFile && !process.env.SERV_API_KEY) {
  console.error(
    "No .env file and no SERV_API_KEY in the environment.\n" +
      "  Local run:  copy .env.example to .env and set SERV_API_KEY.\n" +
      "  Hosted run: set SERV_API_KEY in the host's environment settings.",
  );
  process.exit(1);
}

if (!existsSync(join(root, "ui", "dist", "index.html"))) {
  console.error("ui/dist not built. Run:  pnpm build:all");
  process.exit(1);
}

const host = process.env.API_HOST ?? "127.0.0.1";
const port = process.env.API_PORT ?? process.env.PORT ?? "8787";
if (host === "127.0.0.1" || host === "localhost") {
  console.log(
    "\n  Note: API_HOST is loopback — the site will only be reachable on this\n" +
      "  machine. For a public deploy set API_HOST=0.0.0.0 in .env.\n",
  );
}

console.log(`Starting VAULT-PILOT — interface + API + autonomous scheduler.\n`);

const child = spawn(
  "pnpm",
  ["exec", "tsx", ...(hasEnvFile ? ["--env-file=.env"] : []), "src/api.ts"],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code) => process.exit(code ?? 0));

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setTimeout(() => {
  console.log(`\n  site  http://${host === "0.0.0.0" ? "localhost" : host}:${port}\n`);
}, 1500);
