import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for mcp-memoria.
 *
 * Coverage thresholds (per docs/12 §1 R4 / §4):
 * - Global: ≥95% on lines, branches, functions, statements.
 * - `src/**\/domain/**`     → 100% (pure logic, no I/O — no excuse).
 * - `src/**\/application/**` → 100% (use cases over ports — no excuse).
 * - `src/**\/infrastructure/**` → ≥90% (real edge cases like FS errors).
 *
 * The composition root (`src/composition/**`) is wiring, not testable
 * business logic — excluded from coverage measurement.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    pool: "forks",
    // E2E tests spawn the bundled binary (`dist/cli.js`,
    // `dist/server.js`) via `child_process.spawn` and exchange
    // NDJSON frames. The `init --mode shared` flow runs every
    // shipped migration against a real SQLite database, which on
    // cold tmpdirs can take a few seconds. Lift the per-test
    // timeout to 60s so flaky filesystems don't fail the suite.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // While Fase 1-2 have no tests yet, allow `vitest run` to exit 0.
    // Fase 5 (Testing) will populate `tests/`; remove this if/when CI
    // should reject test-less commits.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/composition/**",
        "src/**/index.ts",
        // Pure-interface adapters (driving / driven ports). These files
        // contain only `interface` / `type` declarations and are erased
        // by `tsc`; they have zero runtime footprint, so v8 reports
        // them as 0% coverage even though there is nothing to execute.
        // Excluding them stops the artificial deflation of the global
        // metric without hiding any real gap (every executable adapter
        // implementing the port is still measured).
        "src/**/*.port.ts",
        // Exception: this port file ships an executable type-guard
        // helper (`isPreCommitHookInstallStatus`) alongside the
        // interface, so it must remain measurable.
        "!src/modules/secrets/application/ports/out/pre-commit-hook-installer.port.ts",
        // Pure repository contracts (driven ports, modular convention).
        // Same reasoning as `*.port.ts` — every file here is a single
        // `export interface XRepository { ... }`.
        "src/modules/*/domain/repositories/*.ts",
        // Type-only utilities under `shared/domain/types/`. Listed
        // file-by-file so we keep `result.ts` (which exports the
        // runtime constructors `ok`, `err`, `isOk`, `isErr`) measured.
        "src/shared/domain/types/branded.ts",
        "src/shared/domain/types/domain-event.ts",
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
        "src/**/domain/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        "src/**/application/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        "src/**/infrastructure/**": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
