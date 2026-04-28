/**
 * Tests for `FilesystemPreCommitHookInstaller`.
 *
 * Exercises every status branch (installed / already-managed /
 * replaced-foreign), the foreign-hook refusal, and the path-sanitiser
 * Result-channel error path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FilesystemPreCommitHookInstaller } from "../../../../src/modules/secrets/infrastructure/hook/filesystem-pre-commit-hook-installer.ts";
import { ForeignHookExistsError } from "../../../../src/modules/secrets/infrastructure/errors/foreign-hook-exists-error.ts";
import { PathSanitizerRule } from "../../../../src/modules/secrets/domain/value-objects/path-sanitizer-rule.ts";

let tmpDir: string;
let installer: FilesystemPreCommitHookInstaller;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-precommit-"));
  installer = new FilesystemPreCommitHookInstaller({
    pathSanitizerRule: PathSanitizerRule.tildeRewrite(null),
  });
  // Real workspaces have a `.git/`. Create it so the installer can
  // succeed; a missing `.git/` is the responsibility of the caller.
  await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("FilesystemPreCommitHookInstaller.install", () => {
  it("installs a fresh hook when none exists", async () => {
    const result = await installer.install({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("installed");
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const text = await fs.readFile(hookPath, "utf8");
    expect(text).toContain("#!/usr/bin/env bash");
    expect(text).toContain("managed-by: recall");
    if (process.platform !== "win32") {
      const stat = await fs.stat(hookPath);
      expect(stat.mode & 0o777).toBe(0o755);
    }
  });

  it("status='already-managed' when the existing hook carries the marker", async () => {
    await installer.install({ workspaceRoot: tmpDir });
    const result = await installer.install({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("already-managed");
  });

  it("refuses a foreign (non-managed) hook unless force=true", async () => {
    const hookDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hookDir, { recursive: true });
    await fs.writeFile(
      path.join(hookDir, "pre-commit"),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    const captured = await installer
      .install({ workspaceRoot: tmpDir })
      .then(
        (r) => ({ kind: "ok" as const, r }),
        (err: unknown) => ({ kind: "err" as const, err }),
      );
    expect(captured.kind).toBe("err");
    if (captured.kind === "err") {
      expect(captured.err).toBeInstanceOf(ForeignHookExistsError);
    }
  });

  it("status='replaced-foreign' when force=true overwrites a foreign hook", async () => {
    const hookDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hookDir, { recursive: true });
    await fs.writeFile(
      path.join(hookDir, "pre-commit"),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    const result = await installer.install({
      workspaceRoot: tmpDir,
      force: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("replaced-foreign");
    const text = await fs.readFile(
      path.join(hookDir, "pre-commit"),
      "utf8",
    );
    expect(text).toContain("managed-by: recall");
  });

  it("returns a Result.err when the path-sanitiser rejects the workspaceRoot (NUL byte)", async () => {
    const rejecting = new FilesystemPreCommitHookInstaller({
      pathSanitizerRule: PathSanitizerRule.tildeRewrite(null),
    });
    const result = await rejecting.install({
      workspaceRoot: `${tmpDir}\0bad`,
    });
    expect(result.kind).toBe("err");
  });

  it("propagates a non-ENOENT readFile error from inspect step", async () => {
    if (process.platform === "win32") return;
    const hookDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hookDir, { recursive: true });
    // Make pre-commit a directory: readFile throws EISDIR (not ENOENT).
    await fs.mkdir(path.join(hookDir, "pre-commit"));
    const captured = await installer
      .install({ workspaceRoot: tmpDir })
      .then(
        (r) => ({ kind: "ok" as const, r }),
        (err: unknown) => ({ kind: "err" as const, err }),
      );
    expect(captured.kind).toBe("err");
    if (captured.kind === "err") {
      // It's an EISDIR Error; not a typed installer error.
      expect(captured.err).toBeInstanceOf(Error);
    }
  });
});
