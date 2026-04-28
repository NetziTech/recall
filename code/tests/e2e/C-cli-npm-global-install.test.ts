/**
 * E2E test — Flow C: simulate the layout produced by `npm install -g
 * @netzi/recall` so the migrations resolver is exercised through the
 * exact symlink chain a real global install creates.
 *
 * Regression: B-CLI-5
 * ───────────────────
 * Before the fix, `resolveDefaultMigrationsDir` anchored on
 * `process.argv[1]` literally. `npm install -g` materialises the bin
 * as a symlink:
 *
 *     <prefix>/bin/recall  →  <prefix>/lib/node_modules/@netzi/recall/dist/cli.js
 *
 * `path.dirname(argvEntry)` therefore returned `<prefix>/bin/` and the
 * resolver looked for `<prefix>/bin/migrations/`,
 * `<prefix>/migrations/`, etc. — none of which exist. The user's
 * `recall init` failed with `migrations directory ... is invalid:
 * cannot read directory: ENOENT`.
 *
 * The fix calls `fs.realpathSync(argvEntry)` BEFORE deriving
 * `entryDir`, so the resolver anchors on the real bundle directory
 * (`<prefix>/lib/node_modules/@netzi/recall/dist/`) where the tsup
 * `onSuccess` hook copied the SQL files. As a defence in depth the
 * resolver ALSO adds `<here>/migrations/` (i.e. relative to
 * `import.meta.url`) so the same layout works when the bundle is
 * imported through a re-exporter that hides argv from us.
 *
 * Why simulate instead of actually running `npm pack` + `npm install`:
 *   - `npm pack` writes a tarball, `npm install` runs the full
 *     dependency resolver on it, and both reach out to the registry on
 *     the first `npm` invocation under a fresh prefix. That makes a
 *     single test take 10-30 s in CI, which is unacceptable for the
 *     regression cost.
 *   - The behaviour we are guarding against is purely about
 *     `process.argv[1]` being a symlink whose target lives elsewhere.
 *     We replicate that exactly by hand-staging the bundle + symlink
 *     in a tmpdir; the resolver does not care whether `npm` made the
 *     symlink or `fs.symlinkSync` did.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT_FROM_HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const REAL_DIST = path.join(REPO_ROOT_FROM_HELPER, "dist");
const REAL_NODE_MODULES = path.join(REPO_ROOT_FROM_HELPER, "node_modules");

interface SimulatedInstall {
  readonly prefixDir: string;
  readonly binSymlink: string;
  readonly bundleDir: string;
  readonly cleanup: () => void;
}

/**
 * Builds an `<prefix>/bin/recall` → `<prefix>/lib/node_modules/@netzi/recall/dist/cli.js`
 * tree in a fresh tmpdir. Mirrors the layout produced by
 * `npm install -g @netzi/recall`:
 *
 *   <prefix>/bin/recall                                          (symlink)
 *   <prefix>/lib/node_modules/@netzi/recall/dist/cli.js          (file)
 *   <prefix>/lib/node_modules/@netzi/recall/dist/migrations/...  (dir)
 *   <prefix>/lib/node_modules/@netzi/recall/node_modules         (symlink → repo node_modules)
 *
 * The repo's own `node_modules` is symlinked into the staged install
 * because the bundle keeps native dependencies external (see
 * `tsup.config.ts`'s `external` list). Copying ~10k files would defeat
 * the point of this test.
 */
function simulateNpmGlobalInstall(): SimulatedInstall {
  const realCli = path.join(REAL_DIST, "cli.js");
  if (!fs.existsSync(realCli)) {
    throw new Error(
      `e2e/C: dist/cli.js missing at ${realCli} — run \`npm run build\` first.`,
    );
  }
  const realMigrationsInDist = path.join(REAL_DIST, "migrations");
  if (!fs.existsSync(realMigrationsInDist)) {
    throw new Error(
      `e2e/C: dist/migrations missing at ${realMigrationsInDist} — the tsup ` +
        `onSuccess hook is supposed to copy them in. Re-run \`npm run build\`.`,
    );
  }
  if (!fs.existsSync(REAL_NODE_MODULES)) {
    throw new Error(
      `e2e/C: node_modules missing at ${REAL_NODE_MODULES} — run \`npm install\` first.`,
    );
  }

  const prefixDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "recall-e2e-npmglobal-"),
  );
  const bundleDir = path.join(
    prefixDir,
    "lib",
    "node_modules",
    "@netzi",
    "recall",
    "dist",
  );
  fs.mkdirSync(bundleDir, { recursive: true });

  // Copy the bundled cli.js (small file).
  fs.copyFileSync(realCli, path.join(bundleDir, "cli.js"));
  // Copy the sourcemap so stack traces remain useful if the test fails.
  const realCliMap = path.join(REAL_DIST, "cli.js.map");
  if (fs.existsSync(realCliMap)) {
    fs.copyFileSync(realCliMap, path.join(bundleDir, "cli.js.map"));
  }

  // Copy migrations next to the bundled cli.js (mirrors what
  // `dist/migrations/` looks like after `npm publish`).
  const stagedMigrations = path.join(bundleDir, "migrations");
  fs.mkdirSync(stagedMigrations, { recursive: true });
  for (const entry of fs.readdirSync(realMigrationsInDist)) {
    const src = path.join(realMigrationsInDist, entry);
    const dst = path.join(stagedMigrations, entry);
    const stat = fs.statSync(src);
    if (stat.isFile()) fs.copyFileSync(src, dst);
  }

  // Symlink node_modules so external deps (better-sqlite3-multiple-ciphers,
  // sqlite-vec, fastembed, etc.) resolve through the staged install.
  // Place it at `<package>/node_modules` so Node's module resolver
  // walks up from `<package>/dist/cli.js` and finds it.
  const stagedPackageDir = path.join(
    prefixDir,
    "lib",
    "node_modules",
    "@netzi",
    "recall",
  );
  const stagedNodeModules = path.join(stagedPackageDir, "node_modules");
  fs.symlinkSync(REAL_NODE_MODULES, stagedNodeModules, "dir");

  // Create the bin symlink the way `npm install -g` does: under
  // `<prefix>/bin/recall`, pointing at the bundled cli.js.
  const binDir = path.join(prefixDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const binSymlink = path.join(binDir, "recall");
  fs.symlinkSync(path.join(bundleDir, "cli.js"), binSymlink, "file");

  return {
    prefixDir,
    binSymlink,
    bundleDir,
    cleanup: (): void => {
      try {
        fs.rmSync(prefixDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns `node <binSymlink> <args>`. We do NOT spawn the symlink
 * directly with the OS shell because that would hide the symlink
 * resolution behind execve and obscure the regression we are
 * exercising. By passing the symlink path to `process.execPath`, Node
 * sees `process.argv[1]` set to the symlink itself — exactly the
 * scenario `npm install -g` produces in production.
 */
function runViaSymlink(
  binSymlink: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    // Strip RECALL_MIGRATIONS_DIR from the inherited env so the test
    // genuinely exercises the resolver. Without this guard, a developer
    // running the suite locally with the override exported would
    // silently bypass the regression.
    const envCopy: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };
    delete envCopy["RECALL_MIGRATIONS_DIR"];

    const child = spawn(process.execPath, [binSymlink, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: envCopy,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `recall init via npm-global symlink timed out after 30s\n` +
            `stdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 30_000);
    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const exit = code ?? (signal !== null ? 128 : 1);
      resolve({ exitCode: exit, stdout, stderr });
    });
    child.stdin.end();
  });
}

describe("e2e / C / npm-global-install layout — B-CLI-5", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn !== undefined) fn();
    }
  });

  it("`recall init` via <prefix>/bin/recall symlink finds bundled migrations and EXIT=0", async () => {
    const install = simulateNpmGlobalInstall();
    cleanups.push(install.cleanup);

    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "recall-e2e-npmglobal-ws-"),
    );
    cleanups.push(() => {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    // Sanity: confirm we are about to spawn through a SYMLINK, not the
    // real file. Without this assertion the test could regress to
    // exercising the literal-argv path and miss the original bug.
    const lstat = fs.lstatSync(install.binSymlink);
    expect(lstat.isSymbolicLink()).toBe(true);

    const result = await runViaSymlink(install.binSymlink, [
      "--non-interactive",
      "init",
      "--workspace",
      workspaceDir,
      "--mode",
      "private",
      "--display-name",
      "npm-global-test",
    ]);

    if (result.exitCode !== 0) {
      // Surface the captured streams for triage when the assertion
      // fails. Without this the failure message is just "expected 0,
      // got N" which makes the regression hard to diagnose.
      throw new Error(
        `recall init exited ${String(result.exitCode)}\n` +
          `stdout:\n${result.stdout}\n` +
          `stderr:\n${result.stderr}`,
      );
    }

    // Workspace artefacts must exist.
    const recallDir = path.join(workspaceDir, ".recall");
    expect(fs.existsSync(recallDir)).toBe(true);
    expect(fs.existsSync(path.join(recallDir, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(recallDir, "recall.db"))).toBe(true);
  });

  it("the bundled migrations directory is sibling to dist/cli.js after build", () => {
    // Smoke check on the build output itself: the resolver fix only
    // works if tsup actually shipped `dist/migrations/`. If a future
    // refactor moves the SQL elsewhere, this test fails LOUDLY rather
    // than letting B-CLI-5 silently regress.
    const distMigrations = path.join(REAL_DIST, "migrations");
    expect(fs.statSync(distMigrations).isDirectory()).toBe(true);
    const sqlFiles = fs
      .readdirSync(distMigrations)
      .filter((f) => f.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(0);
  });
});
