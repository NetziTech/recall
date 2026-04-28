/**
 * Tests for `FilesystemPreCommitHookUninstaller`.
 *
 * Exercises every status branch (`not-installed`, `not-managed`,
 * `removed`, `block-removed`), the symmetric round-trip with
 * `FilesystemPreCommitHookInstaller`, and the path-sanitiser
 * Result-channel rejection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FilesystemPreCommitHookInstaller } from "../../../../src/modules/secrets/infrastructure/hook/filesystem-pre-commit-hook-installer.ts";
import { FilesystemPreCommitHookUninstaller } from "../../../../src/modules/secrets/infrastructure/hook/filesystem-pre-commit-hook-uninstaller.ts";
import { PathSanitizerRule } from "../../../../src/modules/secrets/domain/value-objects/path-sanitizer-rule.ts";

let tmpDir: string;
let installer: FilesystemPreCommitHookInstaller;
let uninstaller: FilesystemPreCommitHookUninstaller;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-uninstall-hook-"));
  installer = new FilesystemPreCommitHookInstaller({
    pathSanitizerRule: PathSanitizerRule.tildeRewrite(null),
  });
  uninstaller = new FilesystemPreCommitHookUninstaller({
    pathSanitizerRule: PathSanitizerRule.tildeRewrite(null),
  });
  // Real workspaces have a `.git/`. Create it so the installer can
  // succeed; a missing `.git/` is the responsibility of the caller.
  await fs.mkdir(path.join(tmpDir, ".git", "hooks"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("FilesystemPreCommitHookUninstaller.uninstall", () => {
  it("status='not-installed' when the hook does not exist", async () => {
    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("not-installed");
  });

  it("status='not-managed' on a foreign hook (no recall marker)", async () => {
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const foreign = "#!/bin/sh\nexit 0\n";
    await fs.writeFile(hookFile, foreign, "utf8");
    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("not-managed");
    // The foreign file MUST survive untouched.
    const after = await fs.readFile(hookFile, "utf8");
    expect(after).toBe(foreign);
  });

  it("status='removed' on a recall-installed hook (full file owned)", async () => {
    const installResult = await installer.install({ workspaceRoot: tmpDir });
    expect(installResult.kind).toBe("ok");
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(await fileExists(hookFile)).toBe(true);

    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // After install + uninstall, the wrapped delimiters around the
    // recall block surround the WHOLE useful body, so the surviving
    // content is just the shebang line — `isEffectivelyEmpty`
    // classifies that as empty and the file is unlinked. The status
    // surfaces as `block-removed` because the delimiters were the
    // signature the adapter detected.
    expect(["block-removed", "removed"]).toContain(result.value.status);
    expect(await fileExists(hookFile)).toBe(false);
  });

  it("status='removed' on a legacy monolithic hook (managed marker only, no wrapped delimiters)", async () => {
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    // Hand-craft the legacy layout (older recall versions emitted
    // this exact shape — no wrapped delimiters yet).
    const legacy = [
      "#!/usr/bin/env bash",
      "# managed-by: recall pre-commit hook v1",
      "set -euo pipefail",
      "exit 0",
      "",
    ].join("\n");
    await fs.writeFile(hookFile, legacy, "utf8");
    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("removed");
    expect(await fileExists(hookFile)).toBe(false);
  });

  it("status='block-removed' on a mixed file: only the recall block is excised", async () => {
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const mixed = [
      "#!/usr/bin/env bash",
      "# managed-by: other-tool",
      "echo 'hello from foreign tool'",
      "# >>> recall pre-commit >>>",
      "# managed-by: recall pre-commit hook v1",
      "set -euo pipefail",
      "recall audit --check-secrets --strict --workspace .",
      "# <<< recall pre-commit <<<",
      "echo 'hello after recall'",
      "exit 0",
      "",
    ].join("\n");
    await fs.writeFile(hookFile, mixed, "utf8");
    await fs.chmod(hookFile, 0o755);

    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("block-removed");

    const after = await fs.readFile(hookFile, "utf8");
    expect(after).not.toContain(">>> recall");
    expect(after).not.toContain("<<< recall");
    expect(after).not.toContain("managed-by: recall");
    expect(after).not.toContain("recall audit");
    // Foreign content must survive verbatim.
    expect(after).toContain("# managed-by: other-tool");
    expect(after).toContain("echo 'hello from foreign tool'");
    expect(after).toContain("echo 'hello after recall'");
    // Executable bit preserved.
    if (process.platform !== "win32") {
      const stat = await fs.stat(hookFile);
      expect(stat.mode & 0o111).not.toBe(0);
    }
  });

  it("idempotent: re-running uninstall after a successful uninstall returns `not-installed`", async () => {
    await installer.install({ workspaceRoot: tmpDir });
    const first = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(first.kind).toBe("ok");
    const second = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.value.status).toBe("not-installed");
  });

  it("returns Result.err when the path sanitiser rejects the workspaceRoot (NUL byte)", async () => {
    const result = await uninstaller.uninstall({
      workspaceRoot: `${tmpDir}\0bad`,
    });
    expect(result.kind).toBe("err");
  });

  it("propagates a non-ENOENT readFile error from inspect step", async () => {
    if (process.platform === "win32") return;
    const hookDir = path.join(tmpDir, ".git", "hooks");
    // Make the hook a directory: readFile throws EISDIR (not ENOENT).
    await fs.mkdir(path.join(hookDir, "pre-commit"));
    const captured = await uninstaller
      .uninstall({ workspaceRoot: tmpDir })
      .then(
        (r) => ({ kind: "ok" as const, r }),
        (cause: unknown) => ({ kind: "err" as const, cause }),
      );
    expect(captured.kind).toBe("err");
  });

  it("excises a wrapped block whose markers appear at file boundaries", async () => {
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    // The wrapped block is the entire file (no shebang, no surrounding
    // foreign content). The adapter must still detect it and surface
    // `block-removed` (the file is empty after excision and the
    // adapter unlinks it).
    const wrappedOnly = [
      "# >>> recall pre-commit >>>",
      "# managed-by: recall pre-commit hook v1",
      "exit 0",
      "# <<< recall pre-commit <<<",
      "",
    ].join("\n");
    await fs.writeFile(hookFile, wrappedOnly, "utf8");
    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("block-removed");
    expect(await fileExists(hookFile)).toBe(false);
  });

  it("walks the line-boundary loops when markers appear mid-line and after end-of-line content", async () => {
    const hookFile = path.join(tmpDir, ".git", "hooks", "pre-commit");
    // Pathological-but-legal layout exercising:
    //   - begin marker preceded by foreign content on the SAME line
    //     (forces `removeWrappedBlock` to walk lineStart backwards
    //     through the prefix bytes — covers the body of the
    //     `while (lineStart > 0 && ...)` loop).
    //   - end marker followed by foreign suffix on the same line
    //     (forces lineEnd to walk forward through suffix bytes —
    //     covers the `while (lineEnd < content.length && ...)`
    //     loop body).
    const finalContent = [
      "#!/usr/bin/env bash",
      "echo 'foreign prefix' && # >>> recall pre-commit >>>",
      "# managed-by: recall pre-commit hook v1",
      "exit 0",
      "# <<< recall pre-commit <<< && echo 'foreign suffix on same line'",
      "echo 'after block'",
      "",
    ].join("\n");
    await fs.writeFile(hookFile, finalContent, "utf8");
    await fs.chmod(hookFile, 0o755);

    const result = await uninstaller.uninstall({ workspaceRoot: tmpDir });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.status).toBe("block-removed");

    const after = await fs.readFile(hookFile, "utf8");
    // The recall block + the markers + everything on the marker
    // lines (including the foreign suffix on the closing-marker
    // line) are gone. The shebang, the prefix-only foreign content
    // BEFORE the begin marker on its own line, and the line AFTER
    // the closing marker survive.
    expect(after).not.toContain(">>> recall");
    expect(after).not.toContain("<<< recall");
    expect(after).not.toContain("managed-by: recall");
    expect(after).not.toContain("foreign suffix on same line");
    expect(after).toContain("#!/usr/bin/env bash");
    expect(after).toContain("echo 'after block'");
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      Reflect.get(cause, "code") === "ENOENT"
    ) {
      return false;
    }
    throw cause;
  }
}
