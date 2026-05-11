/**
 * Tests for `UninstallPreCommitHookUseCase`.
 *
 * The use case is a thin pass-through that adds a logging side
 * effect on top of the `PreCommitHookUninstaller` driven port. The
 * tests cover both `Result` branches (Ok / Err) and every status
 * variant that the port can surface.
 */
import { describe, expect, it } from "vitest";

import { UninstallPreCommitHookUseCase } from "../../../../src/modules/secrets/application/use-cases/uninstall-pre-commit-hook.use-case.ts";
import type {
  PreCommitHookUninstallReceipt,
  PreCommitHookUninstaller,
} from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-uninstaller.port.ts";
import type { PreCommitHookUninstallStatus } from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-uninstaller-status.guard.ts";
import { PathSanitizerError } from "../../../../src/modules/secrets/domain/errors/path-sanitizer-error.ts";
import { SanitizedPath } from "../../../../src/modules/secrets/domain/value-objects/sanitized-path.ts";
import { err, isErr, isOk, ok } from "../../../../src/shared/domain/types/result.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";

function buildUninstaller(
  status: PreCommitHookUninstallStatus,
): PreCommitHookUninstaller {
  const receipt: PreCommitHookUninstallReceipt = {
    hookPath: SanitizedPath.create(".git/hooks/pre-commit"),
    status,
  };
  return {
    uninstall: async () => Promise.resolve(ok(receipt)),
  };
}

describe("UninstallPreCommitHookUseCase", () => {
  it("forwards Ok and logs at info on `not-installed`", async () => {
    const logger = new RecordingLogger();
    const useCase = new UninstallPreCommitHookUseCase(
      buildUninstaller("not-installed"),
      logger,
    );
    const result = await useCase.uninstall({ workspaceRoot: "/tmp/ws" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe("not-installed");
    }
    const info = logger.entries.find((e) => e.level === "info");
    expect(info?.message).toBe("pre-commit hook uninstalled");
    expect(info?.payload).toMatchObject({ status:"not-installed" });
  });

  it("forwards Ok and logs at info on `removed`", async () => {
    const logger = new RecordingLogger();
    const useCase = new UninstallPreCommitHookUseCase(
      buildUninstaller("removed"),
      logger,
    );
    const result = await useCase.uninstall({ workspaceRoot: "/tmp/ws" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe("removed");
    }
    const info = logger.entries.find((e) => e.level === "info");
    expect(info?.payload).toMatchObject({ status:"removed" });
  });

  it("forwards Ok and logs at info on `block-removed`", async () => {
    const logger = new RecordingLogger();
    const useCase = new UninstallPreCommitHookUseCase(
      buildUninstaller("block-removed"),
      logger,
    );
    const result = await useCase.uninstall({ workspaceRoot: "/tmp/ws" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe("block-removed");
    }
    const info = logger.entries.find((e) => e.level === "info");
    expect(info?.payload).toMatchObject({ status:"block-removed" });
  });

  it("forwards Ok and logs at info on `not-managed`", async () => {
    const logger = new RecordingLogger();
    const useCase = new UninstallPreCommitHookUseCase(
      buildUninstaller("not-managed"),
      logger,
    );
    const result = await useCase.uninstall({ workspaceRoot: "/tmp/ws" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe("not-managed");
    }
    const info = logger.entries.find((e) => e.level === "info");
    expect(info?.payload).toMatchObject({ status:"not-managed" });
  });

  it("forwards Err and logs at warn when the path sanitiser rejects the workspace root", async () => {
    const sanitiserError = new PathSanitizerError({
      kind: "path-traversal",
      rawPath: "..",
    });
    const uninstaller: PreCommitHookUninstaller = {
      uninstall: async () => Promise.resolve(err(sanitiserError)),
    };
    const logger = new RecordingLogger();
    const useCase = new UninstallPreCommitHookUseCase(uninstaller, logger);
    const result = await useCase.uninstall({ workspaceRoot: "/tmp/ws" });
    expect(isErr(result)).toBe(true);
    const warn = logger.entries.find((e) => e.level === "warn");
    expect(warn?.message).toBe("pre-commit hook uninstall rejected by path sanitizer");
  });
});
