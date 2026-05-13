/**
 * Bench E — cold start with encrypted workspace.
 *
 * SLO: p95 < 400ms (per HANDOFF §0). The encrypted cold start is the
 * ONLY operation in the SLO doc that exceeds 200ms; the budget
 * absorbs the Argon2id KDF (`64 MiB / 3 / 4` defaults — see
 * `KdfParams.defaults`) plus the SQLCipher PRAGMA-key first-page
 * decrypt.
 *
 * Implementation note (binary spawn unavailable):
 * The CLI's `init --mode encrypted` and `mode encrypted` commands
 * BLOCK on a TTY passphrase prompt — there is no `--passphrase` flag
 * or `RECALL_PASSPHRASE` env var consumed by the entrypoint
 * (per BUG B-012 in `tests/e2e/A-cli-binary.test.ts` and the
 * "encrypted init in non-interactive mode requires the passphrase
 * via the entrypoint adapter" sentinel in
 * `workspace-handlers.ts:131`). We therefore measure the encrypted
 * cold-start cost IN PROCESS via the integration container, which
 * exercises the same `InitializeWorkspaceUseCase` /
 * `UnlockWorkspaceUseCase` paths the CLI binary would. The result
 * captures Argon2id + SQLCipher open + first query, but NOT the
 * `node` boot (~50ms baseline) — combine with bench D's delta to
 * approximate the full binary cold start.
 *
 * Each iteration:
 *   1. Lock the workspace (wipe in-memory key, no I/O cost).
 *   2. Unlock via passphrase (Argon2id KDF dominates).
 *   3. Run a representative read (`stats`) against the encrypted DB.
 *
 * Iterations: 10 measured + 1 warmup. The Argon2id defaults take
 * ~100-300ms per call on a modern laptop; 10 samples is enough to
 * bound p95 within ~10% with reasonable confidence.
 */
import { bench, describe } from "vitest";

import { DisplayName } from "../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { buildTestContainer } from "../integration/_helpers/build-test-container.ts";
import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "E. cold start encrypted (unlock + stats, in-process)";
const TARGET_P95_MS = 400;
const ITERATIONS = 10;
const WARMUP_ITERATIONS = 1;

const PASSPHRASE = "bench-correct-horse-battery-staple-2026";

const ctx = await buildTestContainer({ skipMigrations: true });
process.on("beforeExit", () => {
  void ctx.cleanup();
});

// Seed the encrypted workspace ONCE — this initialises the
// encryption slice, derives the master key, opens SQLCipher, and
// runs every migration against the encrypted handle.
await ctx.workspace.initializeWorkspace.initialize({
  rootPath: WorkspacePath.create(ctx.workspaceRoot),
  mode: WorkspaceMode.encryptedMode(),
  displayName: DisplayName.create("bench-E"),
  embedder: EmbedderSpec.create({
    provider: "transformers",
    model: "Xenova/bge-small-en-v1.5",
  }),
  passphrase: PASSPHRASE,
});

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_P95_MS });

describe("bench / E / cold start encrypted (in-process)", () => {
  bench(
    BENCH_NAME,
    async () => {
      const t0 = performance.now();
      // Lock first so the next unlock has to re-derive the key.
      await ctx.workspace.lockWorkspace.lock({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
      });
      // Unlock — Argon2id KDF runs here.
      await ctx.workspace.unlockWorkspace.unlock({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        passphrase: PASSPHRASE,
      });
      // Representative read against the encrypted DB. The use case
      // hits the projection adapter, which runs ~5 SELECTs.
      await ctx.memory.statsMemory.stats({
        workspaceId: ctx.workspaceId,
      });
      const t1 = performance.now();
      recorder.record(t1 - t0);
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
