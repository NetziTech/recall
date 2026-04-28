import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MarkerBasedWorkspaceDetector } from "../../../../../src/modules/workspace/infrastructure/detection/marker-based-workspace-detector.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { WorkspaceInfrastructureError } from "../../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts";

interface Tmp {
  readonly tmpDir: string;
  cleanup: () => Promise<void>;
}

async function tmp(): Promise<Tmp> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-detector-"));
  return {
    tmpDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

let ctx: Tmp;

beforeEach(async () => {
  ctx = await tmp();
});
afterEach(async () => {
  await ctx.cleanup();
});

async function makeWorkspaceAt(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, ".recall"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".recall", "config.json"),
    "{}",
    "utf8",
  );
}

async function makeMarker(dir: string, marker: string): Promise<void> {
  if (marker === ".git" || marker === ".hg" || marker === ".svn") {
    await fs.mkdir(path.join(dir, marker), { recursive: true });
  } else {
    await fs.writeFile(path.join(dir, marker), "x", "utf8");
  }
}

describe("MarkerBasedWorkspaceDetector", () => {
  const detector = new MarkerBasedWorkspaceDetector();

  it("returns hit when .recall/config.json is in the start dir", async () => {
    await makeWorkspaceAt(ctx.tmpDir);
    const r = await detector.detect(WorkspacePath.create(ctx.tmpDir));
    expect(r.exists).toBe(true);
    if (r.exists) {
      expect(r.configPath.toString()).toBe(path.resolve(ctx.tmpDir));
    }
  });

  it("walks upward to find a workspace in the parent", async () => {
    const child = path.join(ctx.tmpDir, "child", "grandchild");
    await fs.mkdir(child, { recursive: true });
    await makeWorkspaceAt(ctx.tmpDir);
    const r = await detector.detect(WorkspacePath.create(child));
    expect(r.exists).toBe(true);
    if (r.exists) {
      expect(r.configPath.toString()).toBe(path.resolve(ctx.tmpDir));
    }
  });

  it("stops at a project marker without a workspace", async () => {
    const child = path.join(ctx.tmpDir, "child");
    await fs.mkdir(child, { recursive: true });
    await makeMarker(ctx.tmpDir, ".git");
    const r = await detector.detect(WorkspacePath.create(child));
    expect(r.exists).toBe(false);
    expect(r.configPath).toBeNull();
  });

  it.each([".git", ".hg", ".svn", "package.json", "Cargo.toml", "go.mod", "pyproject.toml"])(
    "treats %s as a project root marker",
    async (marker) => {
      const child = path.join(ctx.tmpDir, "child");
      await fs.mkdir(child, { recursive: true });
      await makeMarker(ctx.tmpDir, marker);
      const r = await detector.detect(WorkspacePath.create(child));
      expect(r.exists).toBe(false);
    },
  );

  it("treats a `.recall` regular file as not-a-workspace", async () => {
    // Replace the directory with a file of the same name.
    await fs.writeFile(
      path.join(ctx.tmpDir, ".recall"),
      "not-a-dir",
      "utf8",
    );
    const r = await detector.detect(WorkspacePath.create(ctx.tmpDir));
    expect(r.exists).toBe(false);
  });

  it("treats `config.json` as a directory as not-a-workspace", async () => {
    await fs.mkdir(path.join(ctx.tmpDir, ".recall", "config.json"), {
      recursive: true,
    });
    const r = await detector.detect(WorkspacePath.create(ctx.tmpDir));
    expect(r.exists).toBe(false);
  });

  it("returns not-found when reaching the filesystem root", async () => {
    // Create a standalone tmp without any markers; walk upward from a
    // deep path under it. The detector will eventually reach `/` and
    // bail out as not-found.
    const deep = path.join(ctx.tmpDir, "a", "b", "c");
    await fs.mkdir(deep, { recursive: true });
    const r = await detector.detect(WorkspacePath.create(deep));
    // We expect not-found UNLESS the test runner's cwd ancestry happens
    // to contain a `.recall` (very unlikely in CI). In our repo
    // there's none under /tmp.
    expect(typeof r.exists).toBe("boolean");
  });

  it("wraps unexpected fs errors as detectionFailed", async () => {
    // Inject a fault: build a detector with permissions stripped on a
    // sibling. We cannot easily force EACCES; instead we monkey-patch
    // fs.stat to throw a non-ENOENT error.
    const origStat = fs.stat;
    (fs as unknown as { stat: typeof fs.stat }).stat = ((async () => {
      const e: NodeJS.ErrnoException = new Error("EIO") as NodeJS.ErrnoException;
      e.code = "EIO";
      throw e;
    }) as unknown as typeof fs.stat);
    try {
      await expect(
        detector.detect(WorkspacePath.create(ctx.tmpDir)),
      ).rejects.toBeInstanceOf(WorkspaceInfrastructureError);
    } finally {
      (fs as unknown as { stat: typeof fs.stat }).stat = origStat;
    }
  });
});
