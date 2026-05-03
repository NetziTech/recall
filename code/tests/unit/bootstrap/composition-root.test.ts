/**
 * Unit tests for the bootstrap helpers exposed by
 * `code/src/bootstrap/composition-root.ts`.
 *
 * Covers the `resolvePackageVersion()` helper introduced to close
 * the cosmetic carryover documented in HANDOFF §0 (and §6.20):
 * the JSON-RPC `initialize.serverInfo.version` literal drifted out
 * of sync with `code/package.json` on the beta.4 and beta.5 bumps
 * because the literal lived inline in the bootstrap and required
 * disciplinary re-edit on every release.
 *
 * The tests use VALUES, not SHAPE (Phase-9 rule): asserting that the
 * helper returns the EXACT version string read from the on-disk
 * `package.json`, not just "a non-empty string".
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolvePackageVersion } from "../../../src/bootstrap/composition-root.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads the `version` field from `code/package.json` (the on-disk
 * source of truth). The test file lives at
 * `code/tests/unit/bootstrap/composition-root.test.ts`, so three
 * `..` reach the `code/` directory.
 */
function readPackageJsonVersion(): string {
  const pkgPath = path.resolve(HERE, "..", "..", "..", "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { readonly version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(
      `package.json at ${pkgPath} has no usable 'version' field`,
    );
  }
  return parsed.version;
}

describe("resolvePackageVersion", () => {
  it("returns the version that lives in code/package.json", () => {
    const expected = readPackageJsonVersion();
    const actual = resolvePackageVersion();
    expect(actual).toBe(expected);
  });

  it("returns a non-empty string (defensive — guards against the unknown sentinel leaking on a healthy install)", () => {
    const actual = resolvePackageVersion();
    expect(actual).not.toBe("");
    // The `0.0.0-unknown` sentinel signals that the helper could not
    // locate or parse `package.json`. Receiving it from a healthy
    // checkout would mean the helper's resolution chain is broken.
    expect(actual).not.toBe("0.0.0-unknown");
  });

  it("returns a SemVer-shaped string (defensive — catches accidental refactors that return e.g. the package name)", () => {
    const actual = resolvePackageVersion();
    // Loose SemVer: <digits>.<digits>.<digits> with optional
    // pre-release tag. Tight enough to catch "name leaked through"
    // regressions, loose enough to accept beta tags / build metadata.
    expect(actual).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/);
  });
});
