/**
 * Percentile helpers for the performance benchmark suite (Tarea 5.4).
 *
 * `vitest bench` delegates to tinybench, which exposes p75/p99/p995/p999
 * but NOT p95 — yet the SLOs in `docs/06-stack-tecnico.md` and the
 * Tarea 5.4 brief are stated in p95 terms (`mem.recall < 100ms p95`,
 * `mem.context < 200ms p95`, `mem.remember < 30ms p95`). We capture
 * each iteration's wall-clock duration into a module-level array and
 * compute p50/p95/p99 ourselves so the benchmark reports speak the
 * same language the SLO docs do.
 */

/**
 * Computes the empirical p-th percentile of a (non-empty) sample
 * array. Uses the linear-interpolation method (NIST type 7), which is
 * the same definition tinybench uses for its built-in p99.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    throw new Error("percentile: empty sample array");
  }
  if (p < 0 || p > 100) {
    throw new Error(`percentile: p must be in [0, 100] (got ${String(p)})`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) {
    return sorted[0] ?? 0;
  }
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? 0;
  return a + (b - a) * frac;
}

/** Mean of a non-empty sample array. */
export function mean(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new Error("mean: empty sample array");
  }
  let sum = 0;
  for (const s of samples) sum += s;
  return sum / samples.length;
}

/** Min / max of a non-empty sample array. */
export function minMax(samples: readonly number[]): {
  readonly min: number;
  readonly max: number;
} {
  if (samples.length === 0) {
    throw new Error("minMax: empty sample array");
  }
  let mn = Number.POSITIVE_INFINITY;
  let mx = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    if (s < mn) mn = s;
    if (s > mx) mx = s;
  }
  return { min: mn, max: mx };
}

/** Snapshot of the per-iteration latency distribution. */
export interface BenchStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Computes the canonical SLO-comparable stats from a sample array. */
export function summarize(samples: readonly number[]): BenchStats {
  const { min, max } = minMax(samples);
  return Object.freeze({
    count: samples.length,
    min,
    max,
    mean: mean(samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
  });
}

/**
 * Formats a duration in milliseconds with 2 decimal precision. Used
 * by every bench reporter so the suite's stdout is readable on a
 * narrow CI terminal.
 */
export function fmtMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

/**
 * Pretty-prints a SLO comparison line. Returns the line so callers
 * can also push it to a structured report.
 */
export function formatSlo(input: {
  readonly name: string;
  readonly stats: BenchStats;
  readonly targetMs: number;
}): string {
  const { name, stats, targetMs } = input;
  const verdict = stats.p95 <= targetMs ? "PASS" : "FAIL";
  const delta = stats.p95 - targetMs;
  const deltaSign = delta >= 0 ? "+" : "";
  return (
    `[${verdict}] ${name}: p50=${fmtMs(stats.p50)} ` +
    `p95=${fmtMs(stats.p95)} (target ${fmtMs(targetMs)}, ` +
    `delta=${deltaSign}${fmtMs(delta)}) ` +
    `p99=${fmtMs(stats.p99)} mean=${fmtMs(stats.mean)} n=${String(stats.count)}`
  );
}
