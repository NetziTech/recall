/**
 * E2E test harness for the production binaries (`dist/cli.js` and
 * `dist/server.js`).
 *
 * After the B-009 fix the bundled bootstrap resolves migrations
 * relative to `process.argv[1]` (the entrypoint path), trying
 * `<entry-dir>/migrations/`, `<entry-dir>/../migrations/`, and
 * `<entry-dir>/../../migrations/` in order. The tsup `onSuccess`
 * hook also copies `code/migrations/` into `dist/migrations/` so a
 * shipped binary is self-contained.
 *
 * To exercise the binary in an isolated layout (so tests do not
 * race against the repo source), this harness materialises a
 * staging tree under `os.tmpdir()`:
 *
 *   <staging>/code/dist/cli.js       (copy)
 *   <staging>/code/dist/server.js    (copy)
 *   <staging>/code/node_modules/     (symlink)
 *   <staging>/migrations/            (copy of code/migrations)
 *
 * The bootstrap finds the SQL via the `<entry-dir>/../../migrations/`
 * candidate. The harness exposes `cliPath()` / `serverPath()` so each
 * test can `child_process.spawn` the binary directly. Workspaces
 * live in a sibling tmpdir so tests can wipe them without touching
 * the staging tree (which is reused across the whole suite via
 * `beforeAll`).
 *
 * Lifecycle:
 *   - `setupBinaryHarness()` materialises the staging tree exactly
 *     once per worker (idempotent).
 *   - `freshWorkspace()` mints a fresh tmpdir per test; the caller is
 *     responsible for `cleanup()` in `afterEach`.
 *
 * Cleanup:
 *   - The staging tree is NOT removed in `afterAll`: every worker
 *     reuses the same `os.tmpdir()/mcp-memoria-e2e-<pid>/` location
 *     so multiple test files in one Vitest run share the snapshot.
 *     The OS scrubs `os.tmpdir()` on reboot, which is acceptable for
 *     CI ephemerals.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT_FROM_HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const REAL_DIST = path.join(REPO_ROOT_FROM_HELPER, "dist");
const REAL_MIGRATIONS = path.join(REPO_ROOT_FROM_HELPER, "migrations");
const REAL_NODE_MODULES = path.join(REPO_ROOT_FROM_HELPER, "node_modules");

let cachedStagingRoot: string | null = null;

/**
 * Returns the staging root, materialising it on the first call.
 *
 * The staging tree lives at:
 *   `os.tmpdir()/mcp-memoria-e2e-<pid>/`
 * which guarantees workers in the same `vitest` invocation reuse the
 * snapshot but workers in different invocations do not collide.
 */
export function setupBinaryHarness(): {
  readonly stagingRoot: string;
  readonly cliPath: string;
  readonly serverPath: string;
} {
  if (cachedStagingRoot !== null) {
    return {
      stagingRoot: cachedStagingRoot,
      cliPath: path.join(cachedStagingRoot, "code", "dist", "cli.js"),
      serverPath: path.join(cachedStagingRoot, "code", "dist", "server.js"),
    };
  }

  const realCli = path.join(REAL_DIST, "cli.js");
  const realServer = path.join(REAL_DIST, "server.js");
  if (!fs.existsSync(realCli) || !fs.existsSync(realServer)) {
    throw new Error(
      `e2e harness: dist binaries missing — run \`npm run build\` first (looked at ${REAL_DIST}).`,
    );
  }
  if (!fs.existsSync(REAL_MIGRATIONS)) {
    throw new Error(
      `e2e harness: migrations directory missing at ${REAL_MIGRATIONS}.`,
    );
  }
  if (!fs.existsSync(REAL_NODE_MODULES)) {
    throw new Error(
      `e2e harness: node_modules missing at ${REAL_NODE_MODULES} — run \`npm install\` first.`,
    );
  }

  const stagingRoot = path.join(
    os.tmpdir(),
    `mcp-memoria-e2e-${String(process.pid)}`,
  );
  fs.mkdirSync(path.join(stagingRoot, "code", "dist"), { recursive: true });

  // Copy the binaries (small files, ~hundreds of KB each).
  fs.copyFileSync(realCli, path.join(stagingRoot, "code", "dist", "cli.js"));
  fs.copyFileSync(
    realServer,
    path.join(stagingRoot, "code", "dist", "server.js"),
  );
  // Sourcemaps too, so stack traces remain mapped.
  const realCliMap = path.join(REAL_DIST, "cli.js.map");
  const realServerMap = path.join(REAL_DIST, "server.js.map");
  if (fs.existsSync(realCliMap)) {
    fs.copyFileSync(
      realCliMap,
      path.join(stagingRoot, "code", "dist", "cli.js.map"),
    );
  }
  if (fs.existsSync(realServerMap)) {
    fs.copyFileSync(
      realServerMap,
      path.join(stagingRoot, "code", "dist", "server.js.map"),
    );
  }

  // Symlink node_modules — copying ~10k files would take seconds per
  // run. Symlinks satisfy the bundled `external` resolution because
  // Node treats symlinks transparently for ESM `import` paths.
  const stagedNodeModules = path.join(stagingRoot, "code", "node_modules");
  if (!fs.existsSync(stagedNodeModules)) {
    try {
      fs.symlinkSync(REAL_NODE_MODULES, stagedNodeModules, "dir");
    } catch (err) {
      // Some platforms reject `dir` symlinks for non-admin users
      // (Windows). Fall back to a junction by retrying without the
      // type hint.
      const code = (err as { readonly code?: unknown }).code;
      if (code === "EEXIST") {
        // already linked by a parallel test, fine.
      } else {
        throw err;
      }
    }
  }

  // Copy migrations (tiny — six SQL files).
  const stagedMigrations = path.join(stagingRoot, "migrations");
  if (!fs.existsSync(stagedMigrations)) {
    fs.mkdirSync(stagedMigrations, { recursive: true });
    for (const entry of fs.readdirSync(REAL_MIGRATIONS)) {
      const src = path.join(REAL_MIGRATIONS, entry);
      const dst = path.join(stagedMigrations, entry);
      const stat = fs.statSync(src);
      if (stat.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  cachedStagingRoot = stagingRoot;
  return {
    stagingRoot,
    cliPath: path.join(stagingRoot, "code", "dist", "cli.js"),
    serverPath: path.join(stagingRoot, "code", "dist", "server.js"),
  };
}

/**
 * Allocates a fresh tmpdir to act as a workspace root. Returns a
 * `cleanup()` helper that removes the directory recursively.
 */
export function freshWorkspace(): {
  readonly path: string;
  readonly cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-memoria-e2e-ws-"));
  return {
    path: dir,
    cleanup: (): void => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort — Windows occasionally locks the SQLite handle
        // for a few ms after the child exits.
      }
    },
  };
}

/**
 * Result of {@link runCli}.
 */
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns `node <cliPath> <args>` and waits for completion.
 *
 * Stdout/stderr are captured as UTF-8 strings; the exit code is the
 * integer the process returned (or 128+signal for signalled exits).
 *
 * `options.timeoutMs` defaults to 30 000 ms; the process is killed
 * with `SIGKILL` when the timeout fires and the test fails with a
 * descriptive error.
 *
 * `options.cwd` defaults to the workspace path encoded in `--workspace
 * <path>` if present, else to `process.cwd()`.
 */
export function runCli(
  cliPath: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
    readonly stdin?: string;
  } = {},
): Promise<CliResult> {
  return new Promise<CliResult>((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawn(process.execPath, [cliPath, ...args], spawnOpts);

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `CLI invocation timed out after ${String(options.timeoutMs ?? 30_000)}ms: ${args.join(" ")}\n` +
              `stdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      },
      options.timeoutMs ?? 30_000,
    );

    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      const exit = code ?? (signal !== null ? 128 : 1);
      resolve({ exitCode: exit, stdout, stderr });
    });

    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.end(options.stdin, "utf8");
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Reads the workspace_id stored in the workspace config.
 */
export function readWorkspaceId(workspaceRoot: string): string {
  const configPath = path.join(workspaceRoot, ".mcp-memoria", "config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as { readonly workspace_id?: unknown };
  if (typeof parsed.workspace_id !== "string") {
    throw new Error(`config.json at ${configPath} has no workspace_id`);
  }
  return parsed.workspace_id;
}

/**
 * JSON-RPC 2.0 envelope returned by the MCP stdio server.
 */
export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/**
 * Long-lived MCP server child. Tests open one, drive several
 * requests through it, and close it.
 */
export interface McpServerSession {
  readonly process: ChildProcess;
  request(payload: Record<string, unknown>): Promise<JsonRpcResponse>;
  /**
   * Sends a single raw line (without trailing `\n`) WITHOUT waiting for
   * a response — useful for parse-error and notification cases.
   */
  sendRaw(line: string): Promise<JsonRpcResponse | null>;
  stop(): Promise<void>;
}

/**
 * Spawns a `dist/server.js` MCP server in a workspace and returns a
 * session object that exposes a typed `request()` helper.
 *
 * The server reads NDJSON frames from stdin and writes NDJSON frames
 * to stdout. Each `request()` call resolves with the FIRST response
 * line whose `id` matches the request id. The dispatcher writes
 * sequential responses so this approach is safe under the MVP
 * concurrency model (no pipelining).
 */
export function startMcpServer(
  serverPath: string,
  workspaceRoot: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly startupMs?: number } = {},
): Promise<McpServerSession> {
  return new Promise<McpServerSession>((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: workspaceRoot,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stdoutLogBuffer = "";
    const pending = new Map<
      number | string,
      (response: JsonRpcResponse) => void
    >();
    const orphanQueue: JsonRpcResponse[] = [];
    let stoppedFlag = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    // B-016 fix: the bundled `dist/server.js` now routes pino logs
    // through `pino.destination({fd: 2})` so JSON-RPC responses on
    // stdout are no longer mixed with log frames. We keep the
    // defensive line-by-line parser so the harness still tolerates
    // legacy binaries (pre-B-016) and any pino-pretty leakage from
    // future TTY runs — a non-jsonrpc line on stdout lands in
    // `stdoutLogBuffer` instead of crashing the response loop.
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (rawLine.length > 0) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawLine);
          } catch {
            // Some server output (e.g. pino-pretty in TTY mode) isn't
            // JSON. Accumulate as log lines and continue.
            stdoutLogBuffer += `${rawLine}\n`;
            newlineIndex = stdoutBuffer.indexOf("\n");
            continue;
          }
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "jsonrpc" in parsed
          ) {
            const response = parsed as JsonRpcResponse;
            if (response.id !== null && pending.has(response.id)) {
              const resolver = pending.get(response.id);
              pending.delete(response.id);
              if (resolver !== undefined) resolver(response);
            } else {
              orphanQueue.push(response);
            }
          } else {
            // Non-JSON-RPC line on stdout — almost certainly a pino
            // log frame leaked from the entrypoint. Stash for the
            // readiness probe.
            stdoutLogBuffer += `${rawLine}\n`;
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.on("error", (err: Error) => {
      reject(err);
    });
    child.on("close", () => {
      stoppedFlag = true;
      // Reject any still-pending requests so timeouts surface clearly.
      for (const [id, resolver] of pending.entries()) {
        resolver({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: `MCP server closed before responding (stderr: ${stderrBuffer.slice(0, 500)})`,
          },
        });
      }
      pending.clear();
    });

    // The server logs `mcp-memoria-server starting; waiting for stdio
    // frames` once it is ready to accept input. The marker may land
    // on EITHER stderr (the documented sink) OR stdout (BUG B-016):
    // we accept both so the harness keeps working through the fix.
    const readinessDeadline = Date.now() + (options.startupMs ?? 10_000);
    const checkReady = (): void => {
      if (stoppedFlag) {
        reject(
          new Error(
            `MCP server exited before becoming ready (stdout-log: ${stdoutLogBuffer.slice(0, 500)} | stderr: ${stderrBuffer.slice(0, 500)})`,
          ),
        );
        return;
      }
      const haystack = `${stdoutLogBuffer}\n${stderrBuffer}`;
      if (haystack.includes("waiting for stdio frames")) {
        resolve(buildSession(child, pending, orphanQueue, () => stoppedFlag));
        return;
      }
      if (Date.now() > readinessDeadline) {
        child.kill("SIGKILL");
        reject(
          new Error(
            `MCP server did not become ready within ${String(options.startupMs ?? 10_000)}ms (stdout-log: ${stdoutLogBuffer.slice(0, 500)} | stderr: ${stderrBuffer.slice(0, 500)})`,
          ),
        );
        return;
      }
      setTimeout(checkReady, 25);
    };
    setTimeout(checkReady, 25);
  });
}

function buildSession(
  child: ChildProcess,
  pending: Map<number | string, (response: JsonRpcResponse) => void>,
  orphanQueue: JsonRpcResponse[],
  isStopped: () => boolean,
): McpServerSession {
  const requestImpl = (payload: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const id = payload["id"];
    if (
      id === undefined ||
      id === null ||
      (typeof id !== "number" && typeof id !== "string")
    ) {
      throw new Error("request payload must carry a numeric or string `id`");
    }
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      if (isStopped()) {
        reject(new Error("MCP server is already stopped"));
        return;
      }
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `MCP server did not respond to request id=${String(id)} within 30s`,
          ),
        );
      }, 30_000);
      pending.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      const line = `${JSON.stringify(payload)}\n`;
      child.stdin?.write(line, (err) => {
        if (err !== undefined && err !== null) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(err);
        }
      });
    });
  };

  const sendRawImpl = (line: string): Promise<JsonRpcResponse | null> => {
    return new Promise<JsonRpcResponse | null>((resolve, reject) => {
      if (isStopped()) {
        reject(new Error("MCP server is already stopped"));
        return;
      }
      const startQueueLen = orphanQueue.length;
      child.stdin?.write(`${line}\n`, (err) => {
        if (err !== undefined && err !== null) {
          reject(err);
          return;
        }
        // Poll for the next orphan response — for parse errors the
        // server emits an envelope with `id: null` which is not
        // correlated with anything.
        const deadline = Date.now() + 5_000;
        const tick = (): void => {
          if (orphanQueue.length > startQueueLen) {
            const next = orphanQueue[startQueueLen];
            resolve(next ?? null);
            return;
          }
          if (Date.now() > deadline) {
            resolve(null);
            return;
          }
          setTimeout(tick, 20);
        };
        tick();
      });
    });
  };

  const stopImpl = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (isStopped()) {
        resolve();
        return;
      }
      const onClose = (): void => {
        resolve();
      };
      child.once("close", onClose);
      child.stdin?.end();
      // Worst case the server hangs on a deadlock — escalate after 5s.
      setTimeout(() => {
        if (!isStopped()) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    });
  };

  return {
    process: child,
    request: requestImpl,
    sendRaw: sendRawImpl,
    stop: stopImpl,
  };
}
