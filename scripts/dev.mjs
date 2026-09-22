#!/usr/bin/env node
/**
 * Starts the whole system with one command: the agent API (which drives the
 * autonomous epoch scheduler) and the interface, with interleaved logs and a
 * single Ctrl-C that stops both.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(root, ".env"))) {
  console.error("No .env found. Copy .env.example to .env and set SERV_API_KEY first.");
  process.exit(1);
}

const API_PORT = Number(process.env.API_PORT ?? 8787);
const UI_PORT = Number(process.env.UI_PORT ?? 5173);

function portInUse(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (err) => resolve(err.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
}

/**
 * Both ports are checked up front. Starting halfway leaves a stray process
 * behind and buries the cause in a stack trace; the usual culprit is simply
 * an earlier run that was never stopped.
 */
const busy = [];
if (await portInUse(API_PORT, "127.0.0.1")) busy.push(`API port ${API_PORT}`);
if (await portInUse(UI_PORT, "127.0.0.1")) busy.push(`interface port ${UI_PORT}`);

if (busy.length > 0) {
  console.error(`\n  ${busy.join(" and ")} already in use.\n`);
  console.error(`  Most likely an earlier run is still going. Stop it with:\n`);
  console.error(`    npx kill-port ${API_PORT} ${UI_PORT}`);
  console.error(`    # or:  fuser -k ${API_PORT}/tcp ${UI_PORT}/tcp\n`);
  console.error(`  Or run on different ports:  API_PORT=8788 UI_PORT=5174 pnpm dev\n`);
  process.exit(1);
}

const COLORS = { api: "\x1b[36m", ui: "\x1b[35m", reset: "\x1b[0m" };

const children = [];
let shuttingDown = false;

function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${COLORS[name]}[${name}]${COLORS.reset} `;

  const pipe = (stream) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) process.stdout.write(prefix + line + "\n");
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`${prefix}exited with code ${code}; shutting down`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Keep the API's allowed browser origin and the interface's actual port in
// step, so changing one cannot silently break requests from the other.
const uiOrigin = process.env.UI_ORIGIN ?? `http://localhost:${UI_PORT}`;
process.env.UI_ORIGIN = uiOrigin;
process.env.API_PORT = String(API_PORT);
process.env.UI_PORT = String(UI_PORT);

console.log("Starting VAULT-PILOT — agent + interface.\n");
start("api", "pnpm", ["exec", "tsx", "--env-file=.env", "src/api.ts"], root);
start("ui", "pnpm", ["--filter", "vault-pilot-ui", "dev"], root);

setTimeout(() => {
  if (shuttingDown) return;
  console.log(`\n  interface  ${uiOrigin}`);
  console.log(`  api        http://127.0.0.1:${API_PORT}`);
  console.log(`\n  The agent runs epochs on its own schedule. Ctrl-C stops everything.\n`);
}, 2500);
