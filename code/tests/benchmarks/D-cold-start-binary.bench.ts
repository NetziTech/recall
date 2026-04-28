/**
 * Bench D — cold start binary (`dist/cli.js stats`, shared mode).
 *
 * SLO: p95 < 200ms (per HANDOFF §0 / Tarea 5.4 brief). The metric
 * captures the full path:
 *   1. `node` boot (V8 + ESM loader).
 *   2. `dist/cli.js` ESM module import (via tsup-bundled entrypoint).
 *   3. composition-root wiring (`buildContainer`).
 *   4. `stats --workspace <pre-existing>` command — opens the SQLite
 *      DB, runs the read-only stats query, prints JSON, exits.
 *
 * The workspace is initialised ONCE in shared mode before the bench
 * loop so we measure the steady-state cold start, NOT the first-init
 * cost (which dominates with migrations + projection writer).
 *
 * Iterations: 20 spawns measured + 2 warmup (the brief says N=20).
 * Each iteration spawns a fresh `node` process; we cannot share
 * V8/JIT state, so 20 samples is enough to bound the p95 noise.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { bench, describe } from "vitest";

import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "D. cold start binary (stats, shared mode)";
const TARGET_P95_MS = 200;
const ITERATIONS = 20;
const WARMUP_ITERATIONS = 2;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const CLI_PATH = path.join(REPO_ROOT, "dist", "cli.js");

if (!fs.existsSync(CLI_PATH)) {
  throw new Error(
    `bench D: dist/cli.js missing at ${CLI_PATH}; run \`npm run build\` first.`,
  );
}

// Allocate a workspace that survives the whole bench.
const workspaceRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "recall-bench-D-"),
);
process.on("beforeExit", () => {
  try {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

interface SpawnResult {
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly stderr: string;
}

function spawnCli(args: readonly string[]): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err: Error) => {
      reject(err);
    });
    child.on(
      "close",
      (code: number | null, signal: NodeJS.Signals | null) => {
        const t1 = performance.now();
        const exit = code ?? (signal !== null ? 128 : 1);
        resolve({ exitCode: exit, elapsedMs: t1 - t0, stderr });
      },
    );
  });
}

// Initialise the workspace ONCE.
const initRes = await spawnCli([
  "init",
  "--workspace",
  workspaceRoot,
  "--mode",
  "shared",
  "--display-name",
  "bench-D",
]);
if (initRes.exitCode !== 0) {
  throw new Error(
    `bench D: init failed (exit ${String(initRes.exitCode)}): ${initRes.stderr}`,
  );
}

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_P95_MS });

describe("bench / D / cold start binary (shared)", () => {
  bench(
    BENCH_NAME,
    async () => {
      const res = await spawnCli(["stats", "--workspace", workspaceRoot]);
      if (res.exitCode !== 0) {
        throw new Error(
          `bench D: stats failed (exit ${String(res.exitCode)}): ${res.stderr}`,
        );
      }
      recorder.record(res.elapsedMs);
      if (recorder.samples().length >= ITERATIONS) recorder.markComplete();
    },
    {
      iterations: ITERATIONS,
      time: 0,
      warmupIterations: WARMUP_ITERATIONS,
      warmupTime: 0,
    },
  );
});
