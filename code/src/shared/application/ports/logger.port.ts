/**
 * Driven (output) port for structured logging.
 *
 * Why this lives in `shared/application/ports/`:
 * - Every module emits diagnostic logs (workspace init, recall stats,
 *   curator runs, secrets detection, MCP request handling, etc.); a
 *   logger is the textbook example of a transversal cross-cutting
 *   concern. Per `docs/12-lineamientos-arquitectura.md` §1.5 Regla 3
 *   it MUST live in `shared/`.
 *
 * Why this port is intentionally narrow (no transports, no
 * configuration, no formatters):
 * - SOLID-ISP: callers only need the six syslog-style severity levels
 *   and the ability to bind extra context via `child(...)`. Anything
 *   else (sinks, redaction, sampling) is an infrastructure detail.
 * - SOLID-DIP: the domain MUST not know that the implementation is
 *   `pino` (`docs/06-stack-tecnico.md` §8). Concrete classes live in
 *   `shared/infrastructure/logger/pino-logger.ts`.
 *
 * Implementation expectations (per Fase 2 task `2.2-shared-infrastructure`):
 * - Adapter wraps `pino` with `redactPaths` preconfigured for the
 *   sensitive fields enumerated in `docs/11-seguridad-modos.md`
 *   ("key", "passphrase", "masterKey", "derivedKey",
 *   "encryptionKey", "salt"). The redaction is a security
 *   precondition: if the implementation ships without redaction the
 *   `security-auditor` REJECTS the PR.
 * - Adapter routes warn/error/fatal to stderr; trace/debug/info to
 *   stdout. MCP transport uses stdio, so stdout is reserved for the
 *   JSON-RPC channel — the logger MUST NOT pollute it (see
 *   `docs/02-protocolo-mcp.md` §6).
 * - Adapter uses pino's pretty transport ONLY when running under a
 *   TTY (CLI mode); under the MCP server's stdio transport every
 *   line is JSON.
 *
 * Test doubles (live in `tests/fixtures/`):
 * - `RecordingLogger` captures every call into an array, exposing
 *   `entries()` so tests can assert "an info-level message with
 *   message=... was emitted".
 * - `SilentLogger` (no-op) used by perf benchmarks where logging
 *   would skew the timings.
 */

/**
 * Structured payload accepted by every logging method.
 *
 * Logs are emitted as JSON (per `docs/06-stack-tecnico.md` §8); a
 * `LogPayload` is the bag of structured fields that becomes the JSON
 * body. Implementations MAY enrich it with their own bindings (pid,
 * timestamp, hostname, ...) — those are not the caller's concern.
 *
 * Type design:
 * - `Record<string, unknown>` rather than `Record<string, JsonValue>`
 *   because the logger is allowed to receive `Error` instances,
 *   `Buffer`, `Date`, etc., and is responsible for serialising them
 *   safely. Callers get type-checked at the call site without a
 *   recursive JSON-shaped type.
 */
export type LogPayload = Readonly<Record<string, unknown>>;

/**
 * Driven (output) port: structured logger.
 *
 * Contracts:
 * - Every method takes either `(payload, message?)` or `(message)`.
 *   When called with a string-only argument, that string IS the
 *   message and there is no structured payload.
 * - Implementations MUST NOT throw on a logging call; a logger that
 *   could blow up the request path is worse than no logger at all.
 *   Internal failures (e.g. pino transport down) are routed to a
 *   fallback (stderr.write) silently.
 * - `child(bindings)` returns a *new* `Logger` whose every emission
 *   is enriched with `bindings` merged on top of the parent's
 *   bindings. The parent is unaffected. Used to add `requestId`,
 *   `workspaceId`, `tool` to a request-scoped logger without
 *   plumbing those values manually through every layer.
 *
 * Severity ordering (highest = most severe):
 *   fatal > error > warn > info > debug > trace
 *
 * Use the levels per `docs/02-protocolo-mcp.md` §6 ("Reglas de
 * logging"):
 *   - `trace`/`debug` : developer-visible trail; off by default.
 *   - `info`          : normal lifecycle events (server up, tool
 *                       invoked, curator run completed).
 *   - `warn`          : recoverable degradations (embedder fallback,
 *                       cache miss).
 *   - `error`         : a request failed but the server is healthy.
 *   - `fatal`         : the server cannot continue (corrupt DB,
 *                       missing migration). The process should exit
 *                       after a `fatal`.
 */
export interface Logger {
  /**
   * Emits a `trace`-level entry. Lowest severity; off by default.
   */
  trace(payload: LogPayload | string, message?: string): void;

  /**
   * Emits a `debug`-level entry.
   */
  debug(payload: LogPayload | string, message?: string): void;

  /**
   * Emits an `info`-level entry.
   */
  info(payload: LogPayload | string, message?: string): void;

  /**
   * Emits a `warn`-level entry.
   */
  warn(payload: LogPayload | string, message?: string): void;

  /**
   * Emits an `error`-level entry.
   */
  error(payload: LogPayload | string, message?: string): void;

  /**
   * Emits a `fatal`-level entry. The caller is expected to exit the
   * process shortly after.
   */
  fatal(payload: LogPayload | string, message?: string): void;

  /**
   * Returns a child logger that prepends `bindings` to every entry.
   *
   * The bindings are merged into each log payload before emission;
   * keys in the per-call payload override keys in the bindings.
   * Useful to scope logs to a request, workspace, or tool invocation
   * without reaching for global state.
   */
  child(bindings: LogPayload): Logger;
}
