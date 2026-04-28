/**
 * Integration test — Flow B: encrypted-mode unlock + lock cycle.
 *
 * Walks the canonical encrypted-mode lifecycle wired across the
 * workspace and encryption modules:
 *
 *   init (encrypted)    → workspace + encryption slice on disk
 *     → lock              → cached unlocked key wiped
 *     → unlock (good)     → master key re-derived from passphrase
 *     → unlock (bad)      → typed `WorkspaceLockedError` (no oracle)
 *
 * Asserts the cross-module facades wired in
 * `composition/facades/workspace-encryption-facades.ts` translate
 * `Result<...>` outcomes correctly into the workspace use cases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DisplayName } from "../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

const PASSPHRASE = "correct-horse-battery-staple-2026";
const WRONG_PASSPHRASE = "incorrect-zebra-mountain";

const DEFAULT_EMBEDDER = EmbedderSpec.create({
  provider: "fastembed",
  model: "BGESmallEN15",
});

describe("integration / B / encryption — unlock & lock cycle", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer({ skipMigrations: true });
    // Seed an encrypted workspace.
    await ctx.workspace.initializeWorkspace.initialize({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      mode: WorkspaceMode.encryptedMode(),
      displayName: DisplayName.create("enc-flow"),
      embedder: DEFAULT_EMBEDDER,
      passphrase: PASSPHRASE,
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("unlock with the correct passphrase succeeds", async () => {
    const result = await ctx.workspace.unlockWorkspace.unlock({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      passphrase: PASSPHRASE,
    });
    expect(result.workspace.getMode().isEncrypted()).toBe(true);
    // After init, the workspace aggregate is rehydrated as locked
    // (the runtime unlock flag is not persisted). The first unlock
    // therefore flips wasUnlocked to true.
    expect(result.wasUnlocked).toBe(true);
    expect(result.workspace.isUnlocked()).toBe(true);
  });

  it("unlock with the wrong passphrase throws WorkspaceLockedError without an oracle", async () => {
    await expect(
      ctx.workspace.unlockWorkspace.unlock({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        passphrase: WRONG_PASSPHRASE,
      }),
    ).rejects.toMatchObject({
      // The domain error carries `code === "workspace.locked"`.
      code: "workspace.locked",
    });
  });

  it("each unlock call detects + rehydrates a fresh aggregate (runtime-only flag)", async () => {
    // The `unlocked` flag is intentionally runtime-only (the
    // `WorkspaceRepository` contract documents it). Every `detect()`
    // pulls a fresh, locked aggregate from disk, so re-running
    // `unlock` reports `wasUnlocked: true` again.
    const first = await ctx.workspace.unlockWorkspace.unlock({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      passphrase: PASSPHRASE,
    });
    const second = await ctx.workspace.unlockWorkspace.unlock({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      passphrase: PASSPHRASE,
    });
    expect(first.wasUnlocked).toBe(true);
    expect(second.wasUnlocked).toBe(true);
    expect(second.workspace.isUnlocked()).toBe(true);
  });

  it("lock on a freshly-rehydrated (already-locked) encrypted workspace is a no-op", async () => {
    // The aggregate that `detect()` returns is locked by default. The
    // lock use case short-circuits when `!workspace.isUnlocked()`.
    const locked = await ctx.workspace.lockWorkspace.lock({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
    });
    expect(locked.wasLocked).toBe(false);
    expect(locked.workspace.getMode().isEncrypted()).toBe(true);
  });

  it("lock on a non-encrypted workspace is a no-op", async () => {
    // Build a separate container with a shared workspace.
    const sharedCtx = await buildTestContainer({ skipMigrations: true });
    try {
      await sharedCtx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(sharedCtx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("shared-no-lock"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const result = await sharedCtx.workspace.lockWorkspace.lock({
        rootPath: WorkspacePath.create(sharedCtx.workspaceRoot),
      });
      expect(result.wasLocked).toBe(false);
    } finally {
      await sharedCtx.cleanup();
    }
  });

  it("unlock on a non-encrypted workspace is a no-op", async () => {
    const sharedCtx = await buildTestContainer({ skipMigrations: true });
    try {
      await sharedCtx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(sharedCtx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("shared-no-unlock"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const result = await sharedCtx.workspace.unlockWorkspace.unlock({
        rootPath: WorkspacePath.create(sharedCtx.workspaceRoot),
        passphrase: PASSPHRASE,
      });
      expect(result.wasUnlocked).toBe(false);
    } finally {
      await sharedCtx.cleanup();
    }
  });
});
