/**
 * Coverage for the `isPreCommitHookUninstallStatus` type guard
 * exported alongside the `PreCommitHookUninstaller` driven port.
 */
import { describe, expect, it } from "vitest";
import { isPreCommitHookUninstallStatus } from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-uninstaller.port.ts";

describe("isPreCommitHookUninstallStatus", () => {
  it.each([
    "not-installed",
    "not-managed",
    "removed",
    "block-removed",
  ])("returns true for known status '%s'", (status) => {
    expect(isPreCommitHookUninstallStatus(status)).toBe(true);
  });

  it("returns false for unknown statuses", () => {
    expect(isPreCommitHookUninstallStatus("nope")).toBe(false);
    expect(isPreCommitHookUninstallStatus("")).toBe(false);
    expect(isPreCommitHookUninstallStatus("REMOVED")).toBe(false);
    expect(isPreCommitHookUninstallStatus("installed")).toBe(false);
  });
});
