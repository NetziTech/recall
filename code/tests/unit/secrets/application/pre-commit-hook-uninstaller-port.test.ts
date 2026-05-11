/**
 * Coverage for the `isPreCommitHookUninstallStatus` type guard
 * exported alongside the `PreCommitHookUninstaller` driven port.
 *
 * The helper was extracted out of the `.port.ts` file into a sibling
 * `.guard.ts` to keep ports pure-interface (D-021) and to work around
 * vitest#10164 (negation patterns in `coverage.exclude` produce empty
 * lcov under vitest 4). Tests target the canonical guard file.
 */
import { describe, expect, it } from "vitest";
import { isPreCommitHookUninstallStatus } from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-uninstaller-status.guard.ts";

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
