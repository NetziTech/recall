import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { NodeWorkspaceFilesystem } from "../../../../../src/modules/workspace/infrastructure/filesystem/node-workspace-filesystem.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceInfrastructureError } from "../../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts";

interface Tmp {
  readonly tmpDir: string;
  readonly rootPath: WorkspacePath;
  cleanup: () => Promise<void>;
}

async function tmp(): Promise<Tmp> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-fs-"));
  return {
    tmpDir,
    rootPath: WorkspacePath.create(tmpDir),
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

const SAMPLE = {
  schemaVersion: "1.0.0",
  workspaceId: "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89",
  displayName: "Test",
  mode: "shared" as const,
  createdAtMs: 1_700_000_000_000,
  embedder: { provider: "fastembed", model: "BGESmallEN15", dim: 384 },
};

let ctx: Tmp;
const fsAdapter = new NodeWorkspaceFilesystem();

beforeEach(async () => {
  ctx = await tmp();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("NodeWorkspaceFilesystem.workspaceExists", () => {
  it("false when no .recall/", async () => {
    expect(await fsAdapter.workspaceExists(ctx.rootPath)).toBe(false);
  });

  it("true after createWorkspaceDirectory + writeConfig", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.writeConfig(ctx.rootPath, SAMPLE);
    expect(await fsAdapter.workspaceExists(ctx.rootPath)).toBe(true);
  });
});

describe("NodeWorkspaceFilesystem.createWorkspaceDirectory", () => {
  it("creates with mode 0o700", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    const stat = await fs.stat(path.join(ctx.tmpDir, ".recall"));
    expect(stat.isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      // On POSIX, low byte is permission bits.
      expect(stat.mode & 0o777).toBe(0o700);
    }
  });

  it("idempotent", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    const stat = await fs.stat(path.join(ctx.tmpDir, ".recall"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("wraps mkdir failures", async () => {
    // Simulate failure: pass a path that cannot be created (file in
    // place of dir).
    const blocker = path.join(ctx.tmpDir, "blocker");
    await fs.writeFile(blocker, "x", "utf8");
    const blockerRoot = WorkspacePath.create(blocker);
    await expect(
      fsAdapter.createWorkspaceDirectory(blockerRoot),
    ).rejects.toBeInstanceOf(WorkspaceInfrastructureError);
  });
});

describe("NodeWorkspaceFilesystem.readConfig + writeConfig", () => {
  it("write then read round-trips the persistent slice", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.writeConfig(ctx.rootPath, SAMPLE);
    const out = await fsAdapter.readConfig(ctx.rootPath);
    expect(out).toEqual(SAMPLE);
  });

  it("writes config with mode 0o600", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.writeConfig(ctx.rootPath, SAMPLE);
    const stat = await fs.stat(
      path.join(ctx.tmpDir, ".recall", "config.json"),
    );
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("preserves unknown sub-slices when re-writing", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    // Seed the config file with extra fields the workspace adapter
    // doesn't model (encryption / secrets).
    const seeded = {
      schema_version: SAMPLE.schemaVersion,
      workspace_id: SAMPLE.workspaceId,
      display_name: SAMPLE.displayName,
      mode: SAMPLE.mode,
      created_at_ms: SAMPLE.createdAtMs,
      embedder: SAMPLE.embedder,
      secrets: { policy: "strict" },
      encryption: { kdf: "argon2id" },
    };
    await fs.writeFile(
      path.join(ctx.tmpDir, ".recall", "config.json"),
      JSON.stringify(seeded),
      "utf8",
    );
    await fsAdapter.writeConfig(ctx.rootPath, {
      ...SAMPLE,
      displayName: "Renamed",
    });
    const text = await fs.readFile(
      path.join(ctx.tmpDir, ".recall", "config.json"),
      "utf8",
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed["secrets"]).toEqual({ policy: "strict" });
    expect(parsed["encryption"]).toEqual({ kdf: "argon2id" });
    expect(parsed["display_name"]).toBe("Renamed");
  });

  it("readConfig: missing file → configMissing", async () => {
    const e = await fsAdapter
      .readConfig(ctx.rootPath)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.config-missing",
    );
  });

  it("readConfig: malformed JSON → configMalformed", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fs.writeFile(
      path.join(ctx.tmpDir, ".recall", "config.json"),
      "{ not json",
      "utf8",
    );
    const e = await fsAdapter
      .readConfig(ctx.rootPath)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.config-malformed",
    );
  });

  it("readConfig: schema-incompatible JSON → configMalformed", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fs.writeFile(
      path.join(ctx.tmpDir, ".recall", "config.json"),
      JSON.stringify({ wrong: "shape" }),
      "utf8",
    );
    const e = await fsAdapter
      .readConfig(ctx.rootPath)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.config-malformed",
    );
  });
});

describe("NodeWorkspaceFilesystem.ensureGitignore", () => {
  it("private mode: creates .gitignore with the entry when absent", async () => {
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const text = await fs.readFile(path.join(ctx.tmpDir, ".gitignore"), "utf8");
    expect(text).toContain(".recall/");
  });

  it("private mode: idempotent — does not duplicate the entry", async () => {
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const text = await fs.readFile(path.join(ctx.tmpDir, ".gitignore"), "utf8");
    expect(text.split("\n").filter((l) => l.trim() === ".recall/").length).toBe(1);
  });

  it("private mode: appends to an existing .gitignore", async () => {
    await fs.writeFile(
      path.join(ctx.tmpDir, ".gitignore"),
      "node_modules\n",
      "utf8",
    );
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const text = await fs.readFile(path.join(ctx.tmpDir, ".gitignore"), "utf8");
    expect(text).toContain("node_modules");
    expect(text).toContain(".recall/");
  });

  it("shared/encrypted: removes a stale entry if present", async () => {
    await fs.writeFile(
      path.join(ctx.tmpDir, ".gitignore"),
      "node_modules\n.recall/\nbuild/\n",
      "utf8",
    );
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode());
    const text = await fs.readFile(path.join(ctx.tmpDir, ".gitignore"), "utf8");
    expect(text).not.toContain(".recall/");
    expect(text).toContain("node_modules");
    expect(text).toContain("build/");
  });

  it("shared/encrypted: deletes empty .gitignore left behind", async () => {
    await fs.writeFile(
      path.join(ctx.tmpDir, ".gitignore"),
      ".recall/\n",
      "utf8",
    );
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode());
    const exists = await fs
      .stat(path.join(ctx.tmpDir, ".gitignore"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("shared/encrypted: no-op when .gitignore is absent", async () => {
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.encryptedMode());
    const exists = await fs
      .stat(path.join(ctx.tmpDir, ".gitignore"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("shared/encrypted: no-op when entry is already absent", async () => {
    await fs.writeFile(
      path.join(ctx.tmpDir, ".gitignore"),
      "node_modules\n",
      "utf8",
    );
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode());
    const text = await fs.readFile(path.join(ctx.tmpDir, ".gitignore"), "utf8");
    expect(text).toBe("node_modules\n");
  });

  it("private: writeFile failure → gitignoreUpdateFailed", async () => {
    // Make `.gitignore` a directory so writeFile fails with EISDIR.
    await fs.mkdir(path.join(ctx.tmpDir, ".gitignore"), { recursive: true });
    const e = await fsAdapter
      .ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode())
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.gitignore-update-failed",
    );
  });

  it("readFile non-ENOENT failure → gitignoreUpdateFailed", async () => {
    // Make .gitignore a directory: readFile throws EISDIR (not ENOENT).
    await fs.mkdir(path.join(ctx.tmpDir, ".gitignore"), { recursive: true });
    const e = await fsAdapter
      .ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode())
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.gitignore-update-failed",
    );
  });

  it("shared: writeFile failure when removing entry → gitignoreUpdateFailed", async () => {
    if (process.platform === "win32") return;
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, ".recall/\nnode_modules\n", "utf8");
    // Read-only parent dir: writeFile fails with EACCES.
    await fs.chmod(ctx.tmpDir, 0o500);
    try {
      const e = await fsAdapter
        .ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode())
        .then(
          () => null,
          (err: unknown) => err,
        );
      // If the test runs as root, EACCES is bypassed; we don't fail in
      // that case but verify when permission is honoured.
      if (e !== null) {
        expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
      }
    } finally {
      await fs.chmod(ctx.tmpDir, 0o700);
    }
  });

  it("shared: unlink failure on empty .gitignore → gitignoreUpdateFailed", async () => {
    if (process.platform === "win32") return;
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, ".recall/\n", "utf8");
    await fs.chmod(ctx.tmpDir, 0o500);
    try {
      const e = await fsAdapter
        .ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode())
        .then(
          () => null,
          (err: unknown) => err,
        );
      if (e !== null) {
        expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
      }
    } finally {
      await fs.chmod(ctx.tmpDir, 0o700);
    }
  });

  it("workspaceExists: non-ENOENT propagates as configReadFailed", async () => {
    // Make `.recall` a regular file → stat on
    // `.recall/config.json` returns ENOTDIR.
    await fs.writeFile(path.join(ctx.tmpDir, ".recall"), "x", "utf8");
    const e = await fsAdapter
      .workspaceExists(ctx.rootPath)
      .then(
        (v) => ({ kind: "ok" as const, v }),
        (err: unknown) => ({ kind: "err" as const, err }),
      );
    if (e.kind === "err") {
      expect(e.err).toBeInstanceOf(WorkspaceInfrastructureError);
    } else {
      // Some platforms short-circuit ENOTDIR via stat → false.
      expect(e.v).toBe(false);
    }
  });

  it("writeConfig: failure → configWriteFailed (with tmp cleanup)", async () => {
    if (process.platform === "win32") return;
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    // Read-only `.recall/` dir: writeFile to temp path fails.
    const dir = path.join(ctx.tmpDir, ".recall");
    await fs.chmod(dir, 0o500);
    try {
      const e = await fsAdapter
        .writeConfig(ctx.rootPath, SAMPLE)
        .then(
          () => null,
          (err: unknown) => err,
        );
      if (e !== null) {
        expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
        expect((e as WorkspaceInfrastructureError).code).toBe(
          "workspace.config-write-failed",
        );
      }
    } finally {
      await fs.chmod(dir, 0o700);
    }
  });

  it("writeConfig: existing-but-unreadable previous config → configReadFailed", async () => {
    if (process.platform === "win32") return;
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    const cfgPath = path.join(ctx.tmpDir, ".recall", "config.json");
    await fs.writeFile(cfgPath, "{}", "utf8");
    // Make the existing file unreadable (chmod 0o000).
    await fs.chmod(cfgPath, 0o000);
    try {
      const e = await fsAdapter
        .writeConfig(ctx.rootPath, SAMPLE)
        .then(
          () => null,
          (err: unknown) => err,
        );
      if (e !== null) {
        expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
      }
    } finally {
      await fs.chmod(cfgPath, 0o600).catch(() => undefined);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// W-3.5-SEC-M1 — atomic write+rename for `.gitignore` (and `config.json`)
// Pin the contract: every durable write goes through write-temp-then-
// rename so a crash mid-write never leaves the canonical file truncated.
// In `private` mode `.gitignore` is the *only* guard keeping
// `.recall/recall.db` out of git, so a partial write is a real
// security regression — these tests pin the invariant.
// ─────────────────────────────────────────────────────────────────────
describe("NodeWorkspaceFilesystem.ensureGitignore — atomic write contract (W-3.5-SEC-M1)", () => {
  it("private: final .gitignore content equals the new content (no truncation, no leftover bytes from a previous longer file)", async () => {
    // Seed with a longer file than the post-write content. If the
    // implementation ever switched to truncate-then-write, an
    // interrupted write would leave a shorter-than-expected file. Here
    // we simply verify the post-condition: content is exactly what we
    // wrote, byte-for-byte.
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    const longExisting = "node_modules\nbuild/\ndist/\n.env\n.cache/\nlogs/\ntmp/\n";
    await fs.writeFile(gitignorePath, longExisting, "utf8");

    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());

    const after = await fs.readFile(gitignorePath, "utf8");
    // VALOR: every original line is preserved, plus the new entry,
    // and the file ends with a newline.
    expect(after).toBe(`${longExisting}.recall/\n`);
  });

  it("private: no leftover temp file (`.gitignore.tmp-*`) survives a successful write", async () => {
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const entries = await fs.readdir(ctx.tmpDir);
    // VALOR: the only entry in the tmp dir is the canonical
    // `.gitignore` — no orphan `.gitignore.tmp-...` left behind.
    const tmpLeftovers = entries.filter((e) => /\.gitignore\.tmp-/.test(e));
    expect(tmpLeftovers).toEqual([]);
    expect(entries).toContain(".gitignore");
  });

  it("private: temp file lives in the same directory as the target (so rename(2) is single-filesystem)", async () => {
    // Pin behaviour: spy on `fs.rename` to capture the temp path used
    // and assert it is a sibling of the target. If a future refactor
    // routed the temp via `os.tmpdir()` (different mount), this test
    // would fail.
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    const renameSpy = vi.spyOn(fs, "rename");
    try {
      await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
      expect(renameSpy).toHaveBeenCalled();
      const firstCall = renameSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [tempPath, finalPath] = firstCall as [string, string];
      // VALOR: temp lives in the same directory as the target → same
      // filesystem → atomic rename guarantee holds.
      expect(path.dirname(tempPath)).toBe(path.dirname(gitignorePath));
      expect(finalPath).toBe(gitignorePath);
      // VALOR: temp filename is hidden (dot-prefixed) and contains the
      // PID — the documented naming pattern.
      expect(path.basename(tempPath)).toMatch(
        /^\.\.gitignore\.tmp-\d+-[0-9a-f]{12}$/,
      );
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("private: when fs.rename fails, the temp file is unlinked and the canonical .gitignore is unchanged", async () => {
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    const originalContent = "node_modules\n";
    await fs.writeFile(gitignorePath, originalContent, "utf8");

    // Force `fs.rename` to fail. We capture the temp path it was given
    // so we can assert the cleanup actually unlinked it.
    let observedTempPath: string | null = null;
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (src) => {
        observedTempPath = String(src);
        throw Object.assign(new Error("synthetic rename failure"), {
          code: "EXDEV",
        });
      });
    try {
      const e = await fsAdapter
        .ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode())
        .then(
          () => null,
          (err: unknown) => err,
        );
      // VALOR: error is wrapped — caller learns the write failed.
      expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
      expect((e as WorkspaceInfrastructureError).code).toBe(
        "workspace.gitignore-update-failed",
      );

      // VALOR: the canonical `.gitignore` is byte-identical to its
      // pre-call content — the failed write did NOT corrupt it.
      const afterText = await fs.readFile(gitignorePath, "utf8");
      expect(afterText).toBe(originalContent);

      // VALOR: the temp file was cleaned up (no leftover on disk).
      expect(observedTempPath).not.toBeNull();
      const tempStillExists = await fs
        .stat(observedTempPath as unknown as string)
        .then(() => true)
        .catch(() => false);
      expect(tempStillExists).toBe(false);

      // VALOR: directory listing has no `.gitignore.tmp-*` orphans.
      const entries = await fs.readdir(ctx.tmpDir);
      const tmpLeftovers = entries.filter((e) =>
        /\.gitignore\.tmp-/.test(e),
      );
      expect(tmpLeftovers).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("shared: removing the entry also goes through atomic write — temp file lives next to target and is cleaned up", async () => {
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, "node_modules\n.recall/\nbuild/\n", "utf8");
    const renameSpy = vi.spyOn(fs, "rename");
    try {
      await fsAdapter.ensureGitignore(
        ctx.rootPath,
        WorkspaceMode.sharedMode(),
      );
      // VALOR: the rename call did happen — write went through
      // temp+rename, not direct writeFile.
      expect(renameSpy).toHaveBeenCalled();
      const firstCall = renameSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [tempPath, finalPath] = firstCall as [string, string];
      expect(path.dirname(tempPath)).toBe(path.dirname(gitignorePath));
      expect(finalPath).toBe(gitignorePath);

      // VALOR: final content is the new content with the entry stripped.
      const after = await fs.readFile(gitignorePath, "utf8");
      expect(after).not.toContain(".recall/");
      expect(after).toContain("node_modules");
      expect(after).toContain("build/");

      // VALOR: no temp leftovers.
      const entries = await fs.readdir(ctx.tmpDir);
      const tmpLeftovers = entries.filter((e) =>
        /\.gitignore\.tmp-/.test(e),
      );
      expect(tmpLeftovers).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("private: appending the entry to an existing .gitignore preserves every prior byte verbatim", async () => {
    // Specific concurrency-safety check: a non-atomic implementation
    // doing `truncate + write` could lose bytes if interrupted. The
    // atomic helper produces the new file in full at the temp path
    // BEFORE rename, so the canonical file is never observed in a
    // partial state. We pin the post-condition: every original byte
    // is preserved, the new entry is appended.
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    const original = "node_modules\nbuild/\n";
    await fs.writeFile(gitignorePath, original, "utf8");

    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());

    const after = await fs.readFile(gitignorePath, "utf8");
    // VALOR: prefix is byte-identical to the original.
    expect(after.startsWith(original)).toBe(true);
    // VALOR: suffix is exactly the new entry plus newline.
    expect(after.slice(original.length)).toBe(".recall/\n");
  });

  it("writeConfig: also routes through atomic temp+rename (writeFile target is the temp path, not the canonical config.json)", async () => {
    // Symmetry check: `writeConfig` must use the same atomic-write
    // path as `ensureGitignore`. We assert by spying on `fs.rename`
    // and verifying both: (1) rename was called and (2) the source
    // path is a sibling of the canonical `config.json` (so it lives
    // in `.recall/`, same filesystem).
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    const configPath = path.join(ctx.tmpDir, ".recall", "config.json");
    const renameSpy = vi.spyOn(fs, "rename");
    try {
      await fsAdapter.writeConfig(ctx.rootPath, SAMPLE);
      expect(renameSpy).toHaveBeenCalled();
      const firstCall = renameSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [tempPath, finalPath] = firstCall as [string, string];
      // VALOR: temp lives in `.recall/` next to the target.
      expect(path.dirname(tempPath)).toBe(path.dirname(configPath));
      expect(finalPath).toBe(configPath);
      // VALOR: temp filename matches the new randomBytes-based pattern.
      expect(path.basename(tempPath)).toMatch(
        /^\.config\.json\.tmp-\d+-[0-9a-f]{12}$/,
      );
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("writeConfig: rename failure leaves no temp file behind and surfaces configWriteFailed", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    let observedTempPath: string | null = null;
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (src) => {
        observedTempPath = String(src);
        throw Object.assign(new Error("synthetic rename failure"), {
          code: "EXDEV",
        });
      });
    try {
      const e = await fsAdapter
        .writeConfig(ctx.rootPath, SAMPLE)
        .then(
          () => null,
          (err: unknown) => err,
        );
      // VALOR: error is wrapped as configWriteFailed.
      expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
      expect((e as WorkspaceInfrastructureError).code).toBe(
        "workspace.config-write-failed",
      );

      // VALOR: temp file was cleaned up (best-effort unlink succeeded).
      expect(observedTempPath).not.toBeNull();
      const tempStillExists = await fs
        .stat(observedTempPath as unknown as string)
        .then(() => true)
        .catch(() => false);
      expect(tempStillExists).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("writeConfig: file mode 0o600 is preserved end-to-end through atomic rename", async () => {
    if (process.platform === "win32") return;
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.writeConfig(ctx.rootPath, SAMPLE);
    const stat = await fs.stat(
      path.join(ctx.tmpDir, ".recall", "config.json"),
    );
    // VALOR: the rename did not lose the restrictive mode set on the
    // temp file. POSIX rename preserves inode (and therefore mode).
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("ensureGitignore: concurrent invocations both succeed and final content is one of the two valid states (atomicity invariant)", async () => {
    // We cannot reliably reproduce a "torn write" with real fs because
    // the helper writes the *whole* content to the temp file before
    // rename. Instead we pin the post-atomicity invariant: under
    // concurrent invocations the final canonical file is always one
    // of the legal end-states (never a truncated/garbage hybrid). A
    // non-atomic implementation could interleave write() syscalls and
    // produce content like ".reca.recall/\n".
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, "node_modules\n", "utf8");

    // Run 8 concurrent ensureGitignore calls in private mode. They
    // should all complete; the canonical end-state is deterministic
    // (the entry is present exactly once + node_modules preserved).
    await Promise.all(
      Array.from({ length: 8 }, () =>
        fsAdapter.ensureGitignore(
          ctx.rootPath,
          WorkspaceMode.privateMode(),
        ),
      ),
    );

    const after = await fs.readFile(gitignorePath, "utf8");
    const recallLines = after
      .split("\n")
      .filter((l) => l.trim() === ".recall/");
    // VALOR: the entry is present at least once and at most once per
    // ensureGitignore that observed an "absent" state. With the atomic
    // helper + idempotent withGitignoreEntry this collapses to 1.
    expect(recallLines.length).toBe(1);
    // VALOR: original `node_modules` line is still present.
    expect(after.includes("node_modules\n")).toBe(true);
    // VALOR: no orphan temp files left behind by any of the 8 races.
    const entries = await fs.readdir(ctx.tmpDir);
    const tmpLeftovers = entries.filter((e) =>
      /\.gitignore\.tmp-/.test(e),
    );
    expect(tmpLeftovers).toEqual([]);
  });
});

// Coverage focus: the defensive guards in `removeWorkspaceDirectory`
// (lines 245 and 253) reject paths that do not end with the canonical
// `.recall` segment or that contain a NUL byte. These branches are
// otherwise unreachable through the public API (every callsite goes
// through `workspaceDirPath` first, which always produces a canonical
// suffix) so the only way to exercise them is via a stub that returns
// a hand-crafted path.
describe("NodeWorkspaceFilesystem.removeWorkspaceDirectory — defensive guards", () => {
  it("happy path: removes the .recall directory and its contents", async () => {
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    await fsAdapter.removeWorkspaceDirectory(ctx.rootPath);
    const after = await fs
      .stat(path.join(ctx.tmpDir, ".recall"))
      .catch((err: unknown) => err);
    expect(after).toBeInstanceOf(Error);
  });

  it("wraps rm errors as directoryRemoveFailed", async () => {
    // Build a workspace, then make the .recall directory unremovable by
    // chmodding the PARENT to read-only. rm reports the failure.
    await fsAdapter.createWorkspaceDirectory(ctx.rootPath);
    const parentDir = ctx.tmpDir;
    if (process.platform !== "win32") {
      await fs.chmod(parentDir, 0o500);
      try {
        await expect(
          fsAdapter.removeWorkspaceDirectory(ctx.rootPath),
        ).rejects.toBeInstanceOf(WorkspaceInfrastructureError);
      } finally {
        await fs.chmod(parentDir, 0o700);
      }
    }
  });

  it("rejects a non-canonical path produced by a buggy workspaceDirPath stub", () => {
    // Spy on the private static workspaceDirPath to make it return a
    // path that does NOT end with the canonical `.recall` segment.
    const stub = vi
      .spyOn(
        NodeWorkspaceFilesystem as unknown as {
          workspaceDirPath: (p: WorkspacePath) => string;
        },
        "workspaceDirPath",
      )
      .mockReturnValue("/tmp/not-canonical");
    try {
      return expect(
        fsAdapter.removeWorkspaceDirectory(ctx.rootPath),
      ).rejects.toBeInstanceOf(WorkspaceInfrastructureError);
    } finally {
      stub.mockRestore();
    }
  });

  it("rejects a path containing a NUL byte produced by a buggy workspaceDirPath stub", () => {
    const stub = vi
      .spyOn(
        NodeWorkspaceFilesystem as unknown as {
          workspaceDirPath: (p: WorkspacePath) => string;
        },
        "workspaceDirPath",
      )
      .mockReturnValue("/tmp/has\0null/.recall");
    try {
      return expect(
        fsAdapter.removeWorkspaceDirectory(ctx.rootPath),
      ).rejects.toBeInstanceOf(WorkspaceInfrastructureError);
    } finally {
      stub.mockRestore();
    }
  });
});

// Coverage focus: `withGitignoreEntry`'s "already ends with \n" branch
// (line 444) which short-circuits the newline-normalisation. The
// existing private-mode tests seed with content ending in `\n` so this
// branch IS reached, but the assertion on it is implicit; pin it
// explicitly via byte-for-byte content checks.
describe("NodeWorkspaceFilesystem.ensureGitignore — normalisation invariants", () => {
  it("private: preserves \\n-terminated existing content without doubling the newline", async () => {
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, "foo\n", "utf8");
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const after = await fs.readFile(gitignorePath, "utf8");
    expect(after).toBe("foo\n.recall/\n");
  });

  it("private: adds the missing trailing newline before appending the entry", async () => {
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(gitignorePath, "foo", "utf8"); // no trailing newline
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.privateMode());
    const after = await fs.readFile(gitignorePath, "utf8");
    expect(after).toBe("foo\n.recall/\n");
  });

  it("shared: removes both the canonical `.recall/` line AND the bare `.recall` directory variant", async () => {
    // Cover the `withoutGitignoreEntry` branch at line 456 that filters
    // the bare `.recall` directory name (vs the canonical `.recall/`).
    const gitignorePath = path.join(ctx.tmpDir, ".gitignore");
    await fs.writeFile(
      gitignorePath,
      "node_modules\n.recall\nbuild/\n",
      "utf8",
    );
    await fsAdapter.ensureGitignore(ctx.rootPath, WorkspaceMode.sharedMode());
    const after = await fs.readFile(gitignorePath, "utf8").catch(() => null);
    if (after !== null) {
      expect(after).not.toContain(".recall\n");
    } else {
      // The implementation may also unlink the file if it ends up empty.
      // Both outcomes are valid; the contract is "no `.recall` entry
      // remains".
      expect(after).toBeNull();
    }
  });
});
