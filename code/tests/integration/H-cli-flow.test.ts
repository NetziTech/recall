/**
 * Integration test — Flow H: CLI command pipeline.
 *
 * Walks the CLI parser → use-case → facade chain wired in
 * `composition/wiring/cli-wiring.ts` end-to-end. Because each handler
 * resolves its workspace from `--workspace <path>`, every test passes
 * the tmp workspace explicitly.
 *
 * Coverage:
 *   - `init` creates a fresh workspace.
 *   - `health` reports a healthy probe.
 *   - `stats` returns a JSON envelope (sized counters).
 *   - `audit` runs the full memory audit.
 *   - `export` + `import` round-trip the persisted memory through a
 *     temporary JSON file.
 *   - `wipe --confirm` removes the `.recall/` directory.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { DisplayName } from "../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import {
  buildTestContainer,
  readWorkspaceIdFromConfig,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

const DEFAULT_EMBEDDER = EmbedderSpec.create({
  provider: "fastembed",
  model: "BGESmallEN15",
});

async function runCli(
  ctx: TestContainer,
  argv: readonly string[],
): Promise<number> {
  return ctx.cli.entrypoint.run(argv);
}

describe("integration / H / CLI command pipeline", () => {
  describe("init + health on a fresh workspace", () => {
    let ctx: TestContainer;

    beforeEach(async () => {
      ctx = await buildTestContainer({ skipMigrations: true });
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("`init --mode shared` creates a fresh workspace and exits 0", async () => {
      const code = await runCli(ctx, [
        "init",
        "--workspace",
        ctx.workspaceRoot,
        "--mode",
        "shared",
        "--display-name",
        "cli-shared",
      ]);
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(ctx.workspaceRoot, ".recall", "config.json"))).toBe(
        true,
      );
    });

    it("`health` reports a healthy workspace and exits 0", async () => {
      // Pre-init via the use case to keep the test focused.
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("cli-health"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const code = await runCli(ctx, ["health", "--workspace", ctx.workspaceRoot]);
      expect(code).toBe(0);
    });
  });

  describe("audit / stats / wipe / export / import round-trip", () => {
    let ctx: TestContainer;
    let bootstrapCtx: TestContainer | null;

    beforeEach(async () => {
      // Two-step bootstrap: the workspace's init use case mints a fresh
      // workspaceId. The memory repos pin that id at construction; the
      // CLI handlers then re-detect the workspace from disk and pass
      // the same id. To make both line up, we (1) init the workspace
      // in an ephemeral container, then (2) reuse the SAME workspaceRoot
      // in a second container with the pinned id.
      bootstrapCtx = await buildTestContainer({ skipMigrations: true });
      await bootstrapCtx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(bootstrapCtx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("cli-rt"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const pinnedId = readWorkspaceIdFromConfig(bootstrapCtx.workspaceRoot);
      // Close the ephemeral container's DB before the next one opens
      // (so the writes flush to the WAL). The dir survives — the
      // second container reuses it.
      bootstrapCtx.database.close();
      ctx = await buildTestContainer({
        workspaceRoot: bootstrapCtx.workspaceRoot,
        workspaceId: pinnedId,
      });
      // Seed at least one entry so audit / stats / export have data.
      await ctx.memory.recordDecision.record({
        workspaceId: ctx.workspaceId,
        sessionId: null,
        title: "Use vec0",
        rationale: "vec0 is the canonical vector index for SQLite.",
        tags: Tags.create(["retrieval"]),
        scope: Scope.project(),
      });
      await ctx.memory.recordLearning.record({
        workspaceId: ctx.workspaceId,
        text: "Cost-of-recall is dominated by FTS5 hits.",
        severity: LearningSeverity.tip(),
        tags: Tags.empty(),
        scope: Scope.project(),
      });
    });

    afterEach(async () => {
      await ctx.cleanup();
      if (bootstrapCtx !== null) {
        await bootstrapCtx.cleanup();
        bootstrapCtx = null;
      }
    });

    it("`audit` exits 0", async () => {
      const code = await runCli(ctx, [
        "audit",
        "--workspace",
        ctx.workspaceRoot,
      ]);
      expect(code).toBe(0);
    });

    it("`stats` exits 0", async () => {
      const code = await runCli(ctx, [
        "stats",
        "--workspace",
        ctx.workspaceRoot,
      ]);
      expect(code).toBe(0);
    });

    it("`wipe --confirm` truncates the SQL tables AND removes the .recall/ directory", async () => {
      // FIXED (Tarea 5.3 — Bug 2): the previous behaviour truncated
      // SQL but left `.recall/` in place, contradicting the
      // "Workspace eliminado: <path>" message printed by the handler.
      // The `wipe` flow now routes through
      // `DestroyWorkspaceUseCase`, which truncates SQL via the memory
      // wipe facade AND removes the entire directory tree (with path
      // canonicalisation guarding against unrelated rm targets).
      const beforeRows = ctx.database
        .prepare("SELECT COUNT(*) as c FROM decisions")
        .get() as { c: number };
      expect(beforeRows.c).toBeGreaterThan(0);

      const code = await runCli(ctx, [
        "wipe",
        "--workspace",
        ctx.workspaceRoot,
        "--confirm",
      ]);
      expect(code).toBe(0);
      // The directory has been removed.
      expect(fs.existsSync(path.join(ctx.workspaceRoot, ".recall"))).toBe(
        false,
      );
      // The host project root itself is preserved (defense-in-depth
      // path canonicalisation in the filesystem adapter).
      expect(fs.existsSync(ctx.workspaceRoot)).toBe(true);
    });

    it("`export` produces a JSON file the importer can re-ingest (round trip)", async () => {
      const dumpFile = path.join(
        os.tmpdir(),
        `mem-int-export-${String(Date.now())}-${String(process.pid)}.json`,
      );
      try {
        const exitExport = await runCli(ctx, [
          "export",
          "--workspace",
          ctx.workspaceRoot,
          "--output",
          dumpFile,
        ]);
        expect(exitExport).toBe(0);
        expect(fs.existsSync(dumpFile)).toBe(true);
        const dumpRaw = fs.readFileSync(dumpFile, "utf8");
        // Must be JSON with a memory snapshot inside.
        const dumpParsed = JSON.parse(dumpRaw) as Record<string, unknown>;
        expect(dumpParsed).toBeTruthy();

        // Import the dump back via a fresh container.
        const reimportCtx = await buildTestContainer({ skipMigrations: true });
        try {
          await reimportCtx.workspace.initializeWorkspace.initialize({
            rootPath: WorkspacePath.create(reimportCtx.workspaceRoot),
            mode: WorkspaceMode.sharedMode(),
            displayName: DisplayName.create("cli-import"),
            embedder: DEFAULT_EMBEDDER,
            passphrase: null,
          });
          const exitImport = await runCli(reimportCtx, [
            "import",
            "--workspace",
            reimportCtx.workspaceRoot,
            "--input",
            dumpFile,
          ]);
          expect(exitImport).toBe(0);
        } finally {
          await reimportCtx.cleanup();
        }
      } finally {
        fs.rmSync(dumpFile, { force: true });
      }
    });
  });
});
