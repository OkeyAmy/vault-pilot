export type RunPhase = "idle" | "running" | "done" | "error";

export interface RunStep {
  at: string;
  arm: string | null;
  message: string;
  level: "info" | "ok" | "warn" | "error";
}

export interface RunState {
  phase: RunPhase;
  startedAt: string | null;
  finishedAt: string | null;
  steps: RunStep[];
  error: string | null;
  /** Incremented on every completed run so the UI knows to refetch. */
  generation: number;
}

const MAX_STEPS = 200;

/**
 * Single in-process record of what the current or most recent epoch did.
 * One epoch runs at a time — concurrent runs would race on the per-arm
 * epoch numbering derived from receipts on disk.
 */
class RunStateStore {
  private state: RunState = {
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    steps: [],
    error: null,
    generation: 0,
  };

  get(): RunState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state.phase === "running";
  }

  start(): void {
    this.state = {
      phase: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: [],
      error: null,
      generation: this.state.generation,
    };
  }

  step(message: string, level: RunStep["level"] = "info", arm: string | null = null): void {
    this.state.steps.push({ at: new Date().toISOString(), arm, message, level });
    if (this.state.steps.length > MAX_STEPS) {
      this.state.steps.splice(0, this.state.steps.length - MAX_STEPS);
    }
  }

  finish(): void {
    this.state.phase = "done";
    this.state.finishedAt = new Date().toISOString();
    this.state.generation += 1;
  }

  fail(error: string): void {
    this.state.phase = "error";
    this.state.finishedAt = new Date().toISOString();
    this.state.error = error;
    this.state.generation += 1;
  }
}

export const runState = new RunStateStore();
