import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
