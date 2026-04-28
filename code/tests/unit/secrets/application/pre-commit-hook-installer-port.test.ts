/**
 * Coverage for the `isPreCommitHookInstallStatus` type guard exported
 * alongside the `PreCommitHookInstaller` driving port.
 */
import { describe, expect, it } from "vitest";
import { isPreCommitHookInstallStatus } from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-installer.port.ts";

describe("isPreCommitHookInstallStatus", () => {
  it.each([
    "installed",
    "already-managed",
    "replaced-foreign",
  ])("returns true for known status '%s'", (status) => {
    expect(isPreCommitHookInstallStatus(status)).toBe(true);
  });

  it("returns false for unknown statuses", () => {
    expect(isPreCommitHookInstallStatus("nope")).toBe(false);
    expect(isPreCommitHookInstallStatus("")).toBe(false);
    expect(isPreCommitHookInstallStatus("INSTALLED")).toBe(false);
  });
});
