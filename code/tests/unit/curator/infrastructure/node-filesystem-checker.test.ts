import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFilesystemChecker } from "../../../../src/modules/curator/infrastructure/filesystem/node-filesystem-checker.ts";
import { CuratorInfrastructureError } from "../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

let workspaceRoot: string;
let checker: NodeFilesystemChecker;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "curator-fs-checker-"));
  checker = new NodeFilesystemChecker(workspaceRoot, new SilentLogger());
});

afterEach(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("NodeFilesystemChecker.checkPaths", () => {
  it("returns 'present' when a workspace-relative file exists", async () => {
    const filePath = path.join(workspaceRoot, "exists.ts");
    await fs.writeFile(filePath, "");
    const out = await checker.checkPaths(["exists.ts"]);
    expect(out.length).toBe(1);
    expect(out[0]?.isPresent()).toBe(true);
    expect(out[0]?.path).toBe("exists.ts");
  });

  it("returns 'missing' when a workspace-relative file does not exist", async () => {
    const out = await checker.checkPaths(["does-not-exist.ts"]);
    expect(out.length).toBe(1);
    expect(out[0]?.isMissing()).toBe(true);
    expect(out[0]?.path).toBe("does-not-exist.ts");
  });

  it("returns 'present' for an absolute path that exists", async () => {
    const abs = path.join(workspaceRoot, "abs.ts");
    await fs.writeFile(abs, "");
    const out = await checker.checkPaths([abs]);
    expect(out[0]?.isPresent()).toBe(true);
  });

  it("returns 'present' for an existing directory (not just file)", async () => {
    const dirAbs = path.join(workspaceRoot, "subdir");
    await fs.mkdir(dirAbs);
    const out = await checker.checkPaths(["subdir"]);
    expect(out[0]?.isPresent()).toBe(true);
  });

  it("returns 'unresolvable' (with `<empty>` sentinel) for an empty path", async () => {
    // The adapter is the sanitisation boundary: empty raw input is
    // surfaced as `PathStaleness.unresolvable` carrying the `<empty>`
    // sentinel so the VO's non-empty-path invariant is preserved.
    // Regression guard for B-CURATOR-2.
    const out = await checker.checkPaths([""]);
    expect(out.length).toBe(1);
    expect(out[0]?.isUnresolvable()).toBe(true);
    expect(out[0]?.path).toBe("<empty>");
  });

  it("returns 'unresolvable' for a whitespace-only path", async () => {
    // `resolve(...)` trims the input; an all-whitespace path becomes
    // empty after trimming and must therefore also surface as the
    // `<empty>` sentinel without throwing.
    const out = await checker.checkPaths(["   "]);
    expect(out.length).toBe(1);
    expect(out[0]?.isUnresolvable()).toBe(true);
  });

  it("returns 'unresolvable' for a path containing NUL byte", async () => {
    const out = await checker.checkPaths(["bad\0path.ts"]);
    expect(out[0]?.isUnresolvable()).toBe(true);
  });

  it("preserves input ordering across multiple paths", async () => {
    await fs.writeFile(path.join(workspaceRoot, "a.ts"), "");
    await fs.writeFile(path.join(workspaceRoot, "c.ts"), "");
    const out = await checker.checkPaths(["a.ts", "b-missing.ts", "c.ts"]);
    expect(out.length).toBe(3);
    expect(out[0]?.path).toBe("a.ts");
    expect(out[0]?.isPresent()).toBe(true);
    expect(out[1]?.path).toBe("b-missing.ts");
    expect(out[1]?.isMissing()).toBe(true);
    expect(out[2]?.path).toBe("c.ts");
    expect(out[2]?.isPresent()).toBe(true);
  });

  it("expands '~' to homedir for paths starting with tilde", async () => {
    // This may or may not exist on the test machine, but at minimum the
    // checker should NOT mark it 'unresolvable' purely due to tilde
    // expansion. We check homedir itself which always exists.
    const out = await checker.checkPaths(["~"]);
    expect(out.length).toBe(1);
    expect(out[0]?.isPresent()).toBe(true);
  });

  it("expands '~/relative' (with slash) to homedir/relative", async () => {
    // Probe a path under homedir that does not exist; the result should
    // be 'missing' (NOT unresolvable, NOT throw).
    const out = await checker.checkPaths(["~/__curator_test_does_not_exist_12345__"]);
    expect(out[0]?.isMissing()).toBe(true);
  });

  it("returns frozen result array", async () => {
    const out = await checker.checkPaths(["does-not-exist.ts"]);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("returns empty array for empty input", async () => {
    const out = await checker.checkPaths([]);
    expect(out.length).toBe(0);
  });

  it("raises scanFailed (CuratorInfrastructureError) on permission denied", async () => {
    // Create a directory and remove its read permission so stat fails
    // with EACCES (or a similar error) instead of ENOENT.
    if (process.platform === "win32") return; // chmod is a no-op on Windows
    const restrictedDir = path.join(workspaceRoot, "restricted");
    await fs.mkdir(restrictedDir);
    const childPath = path.join(restrictedDir, "child.ts");
    await fs.writeFile(childPath, "");
    await fs.chmod(restrictedDir, 0o000);
    try {
      await expect(
        checker.checkPaths([path.join(restrictedDir, "child.ts")]),
      ).rejects.toThrow(CuratorInfrastructureError);
    } finally {
      // Restore so afterEach can clean up.
      await fs.chmod(restrictedDir, 0o700);
    }
  });
});
