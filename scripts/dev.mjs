#!/usr/bin/env node
/**
 * Starts the whole system with one command: the agent API (which drives the
 * autonomous epoch scheduler) and the interface, with interleaved logs and a
 * single Ctrl-C that stops both.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(root, ".env"))) {
  console.error("No .env found. Copy .env.example to .env and set SERV_API_KEY first.");
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

console.log("Starting VAULT-PILOT — agent + interface.\n");
start("api", "pnpm", ["exec", "tsx", "--env-file=.env", "src/api.ts"], root);
start("ui", "pnpm", ["--filter", "vault-pilot-ui", "dev"], root);

setTimeout(() => {
  console.log(`\n  interface  http://localhost:5173`);
  console.log(`  api        http://127.0.0.1:8787`);
  console.log(`\n  The agent runs epochs on its own schedule. Ctrl-C stops everything.\n`);
}, 2500);
