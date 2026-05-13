import pino from "pino";
import type { Logger as PinoBaseLogger, LoggerOptions } from "pino";

import type {
  LogPayload,
  Logger,
} from "../../application/ports/logger.port.ts";

/**
 * Default redact paths applied by every {@link PinoLogger} instance,
 * even when the caller does not supply explicit ones.
 *
 * The list mirrors the sensitive keys enumerated in
 * `docs/11-seguridad-modos.md` §3 plus the broader "shape" rules from
 * `docs/12-lineamientos-arquitectura.md` §1.6 ("inputs sensibles
 * NUNCA en logs"). The keys are matched at any depth via the
 * `*.<key>` syntax pino supports natively, so a value buried inside
 * `{request: {body: {passphrase: "..."}}}` is still redacted.
 *
 * Why a baseline rather than relying on the caller:
 * - Defense in depth: a single misconfigured composition root would
 *   otherwise leak a key into stdout. Centralising the list here makes
 *   the security-auditor's job a one-line check
 *   (`grep DEFAULT_REDACT_PATHS`).
 * - The caller MAY append more paths via {@link PinoLoggerOptions.redact};
 *   they are merged on top of the defaults, never replacing them.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = Object.freeze([
  // Direct top-level shapes.
  "passphrase",
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "key",
  "cookie",
  "authorization",
  "masterKey",
  "derivedKey",
  "encryptionKey",
  "salt",
  // FU-A7-3: defense in depth against a future regression that would
  // log the human-readable Bech32 encoding of the master key
  // (`recall export-key` payload). The CLI never logs the field today,
  // but adding it to the baseline ensures even a misrouted child
  // logger or a test-helper print cannot leak it.
  "printableMasterKey",
  // Wildcard variants — pino supports the `*` glob.
  "*.passphrase",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.key",
  "*.cookie",
  "*.authorization",
  "*.masterKey",
  "*.derivedKey",
  "*.encryptionKey",
  "*.salt",
  "*.printableMasterKey",
  // Two-level wildcards for request-style envelopes (e.g. headers).
  //
  // **Pino glob semantics (O-PR45-1, HANDOFF §8):** the `*` segment
  // matches EXACTLY ONE intermediate key. So `*.passphrase` redacts
  // `{req: {passphrase}}` but NOT `{req: {body: {passphrase}}}`.
  // Two-level paths therefore need an explicit middle segment, as the
  // `*.headers.authorization` glob shows; pino does not support `**`
  // recursive matching. If a future caller buries a sensitive value
  // deeper than two levels, add an explicit glob below or sanitise
  // the payload at the call site. Today every caller stays within
  // the two-level shape so no recursion is required.
  "*.headers.authorization",
  "*.headers.cookie",
  // Filesystem paths attached to structured error envelopes
  // (W-3.5-SEC-L1). DatabaseError stores absolute paths under
  // `details.path` / `details.dir` instead of concatenating them into
  // `message`; pino's redactor only walks structured keys, so these
  // globs ensure the path never leaves the process in plaintext when
  // an error is logged via `logger.error({ err }, "...")`. The literal
  // top-level entries cover the rare case where details is logged
  // standalone (e.g. `logger.error({ details })`).
  "details.path",
  "details.dir",
  "*.details.path",
  "*.details.dir",
]);

/**
 * Construction options for {@link PinoLogger}.
 *
 * - `level`  — pino level string (`"trace"` … `"fatal"` or `"silent"`).
 * - `pretty` — when `true`, formats logs via `pino-pretty` if the
 *   transport is available (CLI/dev mode). The MCP server's stdio
 *   transport MUST NOT use pretty mode (`docs/02 §6`); the composition
 *   root sets this to `false` for the server entry-point.
 * - `redact` — additional redact paths merged on top of
 *   {@link DEFAULT_REDACT_PATHS}. Use sparingly; prefer landing
 *   sensitive fields under one of the default key names so the
 *   defense-in-depth list keeps protecting them.
 * - `name` — optional logger name appended to every line; useful when
 *   running multiple workspaces in the same process.
 * - `destination` — file-descriptor sink for the log stream. Defaults
 *   to `1` (stdout) which is pino's default. The MCP stdio server MUST
 *   override to `2` (stderr) so log frames do not collide with
 *   JSON-RPC responses on stdout (see `docs/02 §6` and Bug B-016).
 *   Ignored when `pretty` is `true` (the pino-pretty transport owns
 *   its own destination, and we never use pretty mode in the server
 *   entrypoint).
 */
export interface PinoLoggerOptions {
  readonly level: string;
  readonly pretty?: boolean | undefined;
  readonly redact?: readonly string[] | undefined;
  readonly name?: string | undefined;
  readonly destination?: 1 | 2 | undefined;
}

/**
 * Adapter that fulfils the {@link Logger} port using `pino`.
 *
 * Lifecycle:
 * - {@link PinoLogger.create} builds the underlying pino instance with
 *   default redact paths plus any supplied extras. Pretty mode is
 *   resolved at construction time so the MCP server never accidentally
 *   pollutes stdout.
 * - The constructor is private; an existing pino logger can be wrapped
 *   via {@link PinoLogger.fromPino} (used by `child(...)` to wrap the
 *   pino-side child without re-applying options).
 *
 * Failure isolation:
 * - The {@link Logger} port forbids logger calls from throwing. Every
 *   level method here is wrapped in a `try/catch` that falls back to
 *   `process.stderr.write` so a malfunctioning transport (e.g. broken
 *   pipe) cannot bring down the request path.
 *
 * Composition root example:
 * ```typescript
 * const logger = PinoLogger.create({
 *   level: process.env["LOG_LEVEL"] ?? "info",
 *   pretty: process.stdout.isTTY === true,
 * });
 * const requestLogger = logger.child({ requestId, tool: "mem.recall" });
 * ```
 */
export class PinoLogger implements Logger {
  private constructor(private readonly inner: PinoBaseLogger) {}

  /**
   * Builds a fresh `PinoLogger` from public options.
   *
   * The factory is the only construction path callers should use; the
   * constructor stays private so the underlying pino instance is
   * always built with the security baseline in place.
   */
  public static create(options: PinoLoggerOptions): PinoLogger {
    const redactPaths = PinoLogger.mergeRedactPaths(options.redact);
    const pinoOptions: LoggerOptions = {
      level: options.level,
      redact: {
        paths: [...redactPaths],
        censor: "[REDACTED]",
        remove: false,
      },
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.pretty === true
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname",
              },
            },
          }
        : {}),
    };
    // When pretty mode is OFF and the caller pinned an explicit
    // destination, hand pino a `pino.destination(fd)` so the log stream
    // lands on stdout (fd=1) or stderr (fd=2). pino's default
    // destination is fd=1, which is exactly what would collide with
    // the MCP stdio protocol's JSON-RPC frames — the server entry
    // point sets `destination: 2` to keep stdout exclusive to the
    // protocol (Bug B-016).
    if (options.pretty !== true && options.destination !== undefined) {
      const sink = pino.destination({ fd: options.destination, sync: false });
      return new PinoLogger(pino(pinoOptions, sink));
    }
    return new PinoLogger(pino(pinoOptions));
  }

  /**
   * Wraps an existing pino instance. Used internally by
   * {@link PinoLogger.child} so the bindings inherit the parent's
   * redact configuration without re-creating the transport.
   */
  private static fromPino(inner: PinoBaseLogger): PinoLogger {
    return new PinoLogger(inner);
  }

  private static mergeRedactPaths(
    extra: readonly string[] | undefined,
  ): readonly string[] {
    if (extra === undefined || extra.length === 0) {
      return DEFAULT_REDACT_PATHS;
    }
    const merged = new Set<string>(DEFAULT_REDACT_PATHS);
    for (const path of extra) merged.add(path);
    return [...merged];
  }

  public trace(payload: LogPayload | string, message?: string): void {
    this.emit("trace", payload, message);
  }

  public debug(payload: LogPayload | string, message?: string): void {
    this.emit("debug", payload, message);
  }

  public info(payload: LogPayload | string, message?: string): void {
    this.emit("info", payload, message);
  }

  public warn(payload: LogPayload | string, message?: string): void {
    this.emit("warn", payload, message);
  }

  public error(payload: LogPayload | string, message?: string): void {
    this.emit("error", payload, message);
  }

  public fatal(payload: LogPayload | string, message?: string): void {
    this.emit("fatal", payload, message);
  }

  public child(bindings: LogPayload): Logger {
    try {
      // Pino's `Bindings` is `Record<string, any>`; the port's
      // `LogPayload` is `Readonly<Record<string, unknown>>`. The cast
      // is safe at runtime because pino accepts arbitrary JSONifiable
      // values.
      const childInner = this.inner.child({ ...bindings });
      return PinoLogger.fromPino(childInner);
    } catch (cause: unknown) {
      this.fallback(
        "fatal",
        `pino child() failed: ${PinoLogger.stringifyError(cause)}`,
      );
      // Returning the parent rather than throwing keeps the port
      // contract intact (logger calls MUST NOT throw).
      return this;
    }
  }

  /**
   * Routes a single log call through pino. Wraps the pino throw point
   * in a fallback so the port contract holds.
   */
  private emit(
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
    payload: LogPayload | string,
    message?: string,
  ): void {
    try {
      if (typeof payload === "string") {
        this.inner[level](payload);
      } else if (message === undefined) {
        // Spread to `Bindings` (`Record<string, any>`); the spread
        // preserves the payload's keys without aliasing.
        this.inner[level]({ ...payload });
      } else {
        this.inner[level]({ ...payload }, message);
      }
    } catch (cause: unknown) {
      this.fallback(
        level,
        `pino ${level}() failed: ${PinoLogger.stringifyError(cause)}`,
      );
    }
  }

  private fallback(level: string, line: string): void {
    try {
      // The port forbids throwing; if even stderr.write fails we
      // swallow the error rather than recurse.
      process.stderr.write(`[${level}] ${line}\n`);
    } catch {
      /* unreachable in practice; intentionally swallowed */
    }
  }

  private static stringifyError(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return String(cause);
  }
}
