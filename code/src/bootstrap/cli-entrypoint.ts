#!/usr/bin/env node
/**
 * Entrypoint for the `mcp-memoria` CLI binary.
 *
 * Wire path:
 *   1. Pre-scan `process.argv` for `--workspace <path>` so the
 *      bootstrap can read the workspace's `config.json` and pin the
 *      canonical `WorkspaceId` on every memory-module repository
 *      BEFORE the container is built. Without this, the SQLite
 *      workspace-scoping defence raises `workspace mismatch` (Bug
 *      B-017). Commander parses argv again for the actual command
 *      dispatch downstream — the pre-scan is a read-only preview.
 *   2. Build the composition container with `skipDatabase: true` —
 *      the CLI boots BEFORE knowing whether a workspace exists at the
 *      caller's path. The `init` command opens its own database via
 *      the workspace's `DatabaseBootstrap` adapter; every other CLI
 *      command relies on the database that the bootstrap will lazily
 *      open via the same adapter when invoked. This keeps the
 *      entrypoint synchronous-on-success (no DB locking until the
 *      command actually runs).
 *   3. Forward `process.argv.slice(2)` to the wired `CliEntrypoint`.
 *   4. `process.exit(...)` with the returned code, after flushing
 *      shutdown hooks.
 *
 * Signal handling:
 *   - `SIGINT` / `SIGTERM` trigger `shutdown()` which closes the
 *     database (no-op when `skipDatabase: true`) and zeroes any
 *     unlocked encryption key the resolver still holds.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

import { bootstrapComposition } from "./composition-root.ts";

/**
 * Single-pass argv scan that extracts the value of `--workspace
 * <path>` (or `--workspace=<path>`) without invoking commander. Used
 * before the bootstrap so the workspace-id can be resolved from disk
 * (see Bug B-017). Returns `null` when the flag is absent so the
 * caller falls back to `process.cwd()`.
 */
function previewWorkspaceArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "--workspace") {
      const next = argv[i + 1];
      if (typeof next === "string" && next.length > 0) return next;
      return null;
    }
    if (token.startsWith("--workspace=")) {
      const value = token.slice("--workspace=".length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Returns `true` iff `<root>/.mcp-memoria/config.json` exists and is
 * a regular file. The CLI uses this to decide whether to bootstrap a
 * real SQLite database (commands like `stats` / `audit` / `export`
 * need one) or skip the database (the `init` flow opens the DB
 * itself via the workspace's `DatabaseBootstrap`). The check is
 * synchronous on purpose — the bootstrap path is sync up to the
 * SQLite open, and the additional `stat()` is negligible.
 */
function workspaceConfigExists(workspaceRoot: string): boolean {
  const configPath = path.join(workspaceRoot, ".mcp-memoria", "config.json");
  try {
    return fs.statSync(configPath).isFile();
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const previewedWorkspace = previewWorkspaceArg(argv);
  const workspaceRoot =
    previewedWorkspace !== null
      ? path.resolve(previewedWorkspace)
      : process.cwd();

  // The CLI dispatches a heterogeneous mix of commands: `init` mints
  // a workspace from scratch (DB opened via the workspace adapter
  // itself) while `stats` / `audit` / `export` / `import` / `wipe` /
  // `mode` / `health` operate against an existing database. We detect
  // the post-init case by probing `config.json` synchronously and
  // bootstrap WITH the database when the workspace is already
  // present. Without this branch, the SQLite repositories receive an
  // `UnavailableDatabaseConnection` and every read use case raises
  // `bootstrap.database-unavailable` (root cause of B-014/B-015/B-018
  // alongside B-017).
  const hasInitialisedWorkspace = workspaceConfigExists(workspaceRoot);

  const { container, shutdown } = await bootstrapComposition({
    workspaceRoot,
    skipDatabase: !hasInitialisedWorkspace,
  });

  // The closure mutates `value` through the `state` object so the
  // narrow analysis in TypeScript / ESLint cannot prove the field is
  // always `false` at the `try`/`finally` boundary below.
  const state: { value: boolean } = { value: false };
  const onSignal = (signal: NodeJS.Signals): void => {
    if (state.value) return;
    state.value = true;
    container.logger.info({ signal }, "received signal; shutting down");
    void shutdown().finally(() => {
      process.exit(signal === "SIGTERM" ? 143 : 130);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    return await container.cli.entrypoint.run(argv);
  } finally {
    if (!state.value) await shutdown();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Pre-logger fatal: the only acceptable place for `process.stderr`
    // outside of pino. Composition is supposed to wire the logger
    // before this branch, but if `bootstrapComposition` itself
    // throws we have nothing else.
    process.stderr.write(
      `mcp-memoria: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
