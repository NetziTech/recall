/**
 * Unit test for `CliUninstallHookFacadeAdapter`.
 *
 * The adapter is the cross-module bridge between the CLI's
 * `UninstallHookFacade` driving port and the secrets module's
 * `UninstallPreCommitHookUseCase`. It collapses the four
 * `PreCommitHookUninstallStatus` variants into the binary
 * `removedAt: string | null` wire shape the CLI handler consumes.
 *
 * The composition root is excluded from the global coverage report
 * (see `vitest.config.ts`), but the facade adapter is the only
 * production code that performs the status -> wire-shape mapping,
 * so the regression payoff of an explicit test is high.
 */
import { describe, expect, it } from "vitest";

import { CliUninstallHookFacadeAdapter } from "../../../../src/composition/facades/cli-facades.ts";
import type { UninstallPreCommitHook } from "../../../../src/modules/secrets/application/ports/in/uninstall-pre-commit-hook.port.ts";
import type {
  PreCommitHookUninstallReceipt,
  PreCommitHookUninstallStatus,
} from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-uninstaller.port.ts";
import { PathSanitizerError } from "../../../../src/modules/secrets/domain/errors/path-sanitizer-error.ts";
import { SanitizedPath } from "../../../../src/modules/secrets/domain/value-objects/sanitized-path.ts";
import { err, ok } from "../../../../src/shared/domain/types/result.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";

function buildUseCase(
  status: PreCommitHookUninstallStatus,
): UninstallPreCommitHook {
  const receipt: PreCommitHookUninstallReceipt = {
    hookPath: SanitizedPath.create(".git/hooks/pre-commit"),
    status,
  };
  return {
    uninstall: async () => Promise.resolve(ok(receipt)),
  };
}

describe("CliUninstallHookFacadeAdapter", () => {
  it("removedAt=null when status is `not-installed`", async () => {
    const adapter = new CliUninstallHookFacadeAdapter(
      buildUseCase("not-installed"),
      new RecordingLogger(),
    );
    const out = await adapter.uninstall({ rootPath: "/tmp/ws" });
    expect(out.removedAt).toBeNull();
  });

  it("removedAt=null when status is `not-managed`", async () => {
    const adapter = new CliUninstallHookFacadeAdapter(
      buildUseCase("not-managed"),
      new RecordingLogger(),
    );
    const out = await adapter.uninstall({ rootPath: "/tmp/ws" });
    expect(out.removedAt).toBeNull();
  });

  it("removedAt is the sanitised hook path when status is `removed`", async () => {
    const adapter = new CliUninstallHookFacadeAdapter(
      buildUseCase("removed"),
      new RecordingLogger(),
    );
    const out = await adapter.uninstall({ rootPath: "/tmp/ws" });
    expect(out.removedAt).toBe(".git/hooks/pre-commit");
  });

  it("removedAt is the sanitised hook path when status is `block-removed`", async () => {
    const adapter = new CliUninstallHookFacadeAdapter(
      buildUseCase("block-removed"),
      new RecordingLogger(),
    );
    const out = await adapter.uninstall({ rootPath: "/tmp/ws" });
    expect(out.removedAt).toBe(".git/hooks/pre-commit");
  });

  it("propagates `PathSanitizerError` as a thrown value and logs at warn", async () => {
    const sanitiserError = new PathSanitizerError({
      kind: "path-traversal",
      rawPath: "..",
    });
    const useCase: UninstallPreCommitHook = {
      uninstall: async () => Promise.resolve(err(sanitiserError)),
    };
    const logger = new RecordingLogger();
    const adapter = new CliUninstallHookFacadeAdapter(useCase, logger);
    const captured = await adapter
      .uninstall({ rootPath: "/tmp/ws" })
      .then(
        () => ({ kind: "ok" as const }),
        (cause: unknown) => ({ kind: "err" as const, cause }),
      );
    expect(captured.kind).toBe("err");
    if (captured.kind === "err") {
      expect(captured.cause).toBe(sanitiserError);
    }
    const warn = logger.entries.find((e) => e.level === "warn");
    expect(warn?.message).toBe("uninstall-hook rejected by path sanitizer");
  });
});
