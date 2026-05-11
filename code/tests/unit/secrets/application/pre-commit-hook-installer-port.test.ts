/**
 * Coverage for the `isPreCommitHookInstallStatus` type guard exported
 * alongside the `PreCommitHookInstaller` driving port.
 *
 * The helper was extracted out of the `.port.ts` file into a sibling
 * `.guard.ts` to keep ports pure-interface (D-021) and to work around
 * vitest#10164 (negation patterns in `coverage.exclude` produce empty
 * lcov under vitest 4). Tests target the canonical guard file.
 */
import { describe, expect, it } from "vitest";
import { isPreCommitHookInstallStatus } from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-installer-status.guard.ts";

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
