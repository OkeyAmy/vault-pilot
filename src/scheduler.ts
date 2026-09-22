import { runTournamentEpoch } from "./epoch-runner.js";
import { runState } from "./run-state.js";

const DEFAULT_INTERVAL_SECONDS = 3600;
const DEFAULT_START_DELAY_SECONDS = 5;

export interface SchedulerHandle {
  stop(): void;
  nextRunAt(): string | null;
}

function intervalSeconds(): number {
  const raw = process.env.EPOCH_INTERVAL_SECONDS;
  if (!raw) return DEFAULT_INTERVAL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 30) {
    throw new Error(
      `EPOCH_INTERVAL_SECONDS must be a number >= 30, got "${raw}". ` +
        `Shorter intervals would exhaust provider rate limits.`,
    );
  }
  return parsed;
}

function schedulerEnabled(): boolean {
  return process.env.EPOCH_SCHEDULER !== "off";
}

/**
 * Drives epochs on a fixed cadence for as long as the process is alive.
 *
 * This is the agent's normal operating mode: it allocates on its own
 * schedule rather than waiting to be asked, which is also what makes the
 * anchored timestamps meaningful — they accumulate on a clock nobody is
 * steering after the fact.
 *
 * A run already in flight is never overlapped; epoch numbering is derived
 * from receipts on disk and concurrent runs would race on it.
 */
export function startScheduler(): SchedulerHandle {
  if (!schedulerEnabled()) {
    console.log("epoch scheduler disabled (EPOCH_SCHEDULER=off)");
    return { stop: () => {}, nextRunAt: () => null };
  }

  const seconds = intervalSeconds();
  let timer: NodeJS.Timeout | null = null;
  let nextAt: number | null = null;
  let stopped = false;

  const runOnce = async () => {
    if (stopped) return;
    if (runState.isRunning()) {
      console.log("scheduler: previous epoch still running, skipping this tick");
      return;
    }
    runState.start();
    runState.step(`Scheduled epoch starting (every ${seconds}s)`);
    try {
      await runTournamentEpoch((message, level, arm) => runState.step(message, level, arm));
      runState.finish();
    } catch (err) {
      const message = (err as Error).message;
      runState.step(message, "error");
      runState.fail(message);
      // A failed epoch must not stop the schedule; the next tick retries.
      console.error(`scheduler: epoch failed: ${message}`);
    }
  };

  const schedule = (delayMs: number) => {
    nextAt = Date.now() + delayMs;
    timer = setTimeout(() => {
      void runOnce().finally(() => {
        if (!stopped) schedule(seconds * 1000);
      });
    }, delayMs);
  };

  const startDelay = Number(process.env.EPOCH_START_DELAY_SECONDS ?? DEFAULT_START_DELAY_SECONDS);
  console.log(
    `epoch scheduler on: every ${seconds}s, first run in ${startDelay}s`,
  );
  schedule(startDelay * 1000);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      nextAt = null;
    },
    nextRunAt: () => (nextAt === null ? null : new Date(nextAt).toISOString()),
  };
}
