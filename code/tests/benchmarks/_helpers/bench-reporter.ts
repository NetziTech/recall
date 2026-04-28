/**
 * Cross-bench reporter for the perf suite (Tarea 5.4).
 *
 * Vitest's bench mode prints a tinybench-style table (hz / mean /
 * p99 / rme) but does NOT report p95, which is the percentile our
 * SLOs are written in (`docs/06-stack-tecnico.md`,
 * `docs/01-arquitectura.md` §10).
 *
 * We collect per-iteration timings into a per-bench array and emit
 * an SLO comparison line on `markComplete()`. The bench fn calls
 * `recorder.record(ms)` after each iteration and `recorder.markComplete()`
 * inside the LAST iteration (i.e., when `samples.length === iterations`).
 *
 * Why per-bench-fn instead of `process.beforeExit`: vitest runs
 * benches in a forked worker pool (`pool: "forks"`); the worker
 * process emits its results via RPC and exits. `process.beforeExit`
 * does fire in the worker, but its `console.log` output races with
 * vitest's reporter teardown — sometimes it is interleaved correctly,
 * other times it is dropped. Emitting the SLO line from inside the
 * bench callback (which IS captured) is the only reliable surface.
 */
import { fmtMs, formatSlo, summarize, type BenchStats } from "./percentiles.ts";

interface BenchEntry {
  readonly name: string;
  readonly targetMs: number;
  readonly samples: number[];
  errorMessage: string | null;
  reported: boolean;
}

const REGISTRY: Map<string, BenchEntry> = new Map<string, BenchEntry>();

/**
 * Registers a bench entry under a unique name. Returns helpers the
 * bench fn calls to push samples and emit the SLO comparison.
 */
export function registerBench(input: {
  readonly name: string;
  readonly targetMs: number;
}): {
  readonly record: (sampleMs: number) => void;
  readonly recordError: (message: string) => void;
  readonly markComplete: () => void;
  readonly samples: () => readonly number[];
} {
  let entry = REGISTRY.get(input.name);
  if (entry === undefined) {
    entry = {
      name: input.name,
      targetMs: input.targetMs,
      samples: [],
      errorMessage: null,
      reported: false,
    };
    REGISTRY.set(input.name, entry);
  }
  const captured = entry;
  return {
    record: (sampleMs: number): void => {
      captured.samples.push(sampleMs);
    },
    recordError: (message: string): void => {
      // First error wins so the verdict surface clearly identifies
      // the root cause; subsequent failures (e.g. cleanup-time)
      // overwrite nothing.
      if (captured.errorMessage === null) {
        captured.errorMessage = message;
      }
    },
    markComplete: (): void => {
      if (captured.reported) return;
      captured.reported = true;
      if (captured.errorMessage !== null) {
        console.log(
          `\n[SLO] [ERROR] ${captured.name}: bench aborted — ${captured.errorMessage}\n`,
        );
        return;
      }
      if (captured.samples.length === 0) {
        console.log(`\n[SLO] [SKIP] ${captured.name}: no samples recorded\n`);
        return;
      }
      const stats = summarize(captured.samples);
      const line = formatSlo({
        name: captured.name,
        stats,
        targetMs: captured.targetMs,
      });
      console.log(`\n[SLO] ${line}\n`);
    },
    samples: (): readonly number[] => captured.samples,
  };
}

/**
 * Read-only accessor for tests that want to assert against a recorded
 * bench's stats.
 */
export function readStats(name: string): BenchStats | null {
  const entry = REGISTRY.get(name);
  if (entry === undefined || entry.samples.length === 0) return null;
  return summarize(entry.samples);
}

/** Re-exported for ergonomics. */
export { fmtMs, formatSlo };
