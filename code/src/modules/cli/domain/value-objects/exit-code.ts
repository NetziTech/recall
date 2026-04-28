import { InvalidExitCodeError } from "../errors/invalid-exit-code-error.ts";

/**
 * Catalog of named exit codes used by the `mcp-memoria` CLI. Single
 * source of truth: the `ExitCodeKind` union and the numeric mapping are
 * both derived from this object so adding a new code is a one-line edit.
 *
 * Values follow the conventions in `docs/07-instalacion.md` (UNIX
 * standards) and `docs/11-seguridad-modos.md` §8 (project-specific
 * meanings):
 *
 * - `0` success — POSIX convention for "all good".
 * - `1` genericError — POSIX convention for "something went wrong".
 * - `2` usageError — POSIX convention for "invalid invocation"
 *   (used by `getopt`, `argparse`, etc.).
 * - `3` invalidConfig — `.mcp-memoria/config.json` is missing or
 *   malformed (caller should run `mcp-memoria init`).
 * - `4` lockedWorkspace — encrypted workspace without key in HOME
 *   (caller should run `mcp-memoria unlock`).
 *   Mirrors the JSON-RPC code `-32107 ENCRYPTED_LOCKED`.
 * - `5` invalidKey — the key the user supplied does not open the DB.
 *   Mirrors the JSON-RPC code `-32108 INVALID_KEY`.
 * - `6` keyRevoked — the key was invalidated by a previous `rekey`.
 *   Mirrors the JSON-RPC code `-32109 KEY_REVOKED`.
 * - `7` secretDetected — a write was rejected because the input
 *   matched a secret pattern. Mirrors the JSON-RPC code
 *   `-32105 SECRET_DETECTED`.
 *
 * The numeric values 1..7 are stable: scripts in CI may branch on them.
 * Values >= 8 are reserved for future codes; we never reuse a number.
 *
 * Pattern note: same `as const` SSOT used in `WorkspaceMode` and
 * `JsonRpcErrorCodes`.
 */
const EXIT_CODES = {
  success: 0,
  genericError: 1,
  usageError: 2,
  invalidConfig: 3,
  lockedWorkspace: 4,
  invalidKey: 5,
  keyRevoked: 6,
  secretDetected: 7,
} as const;

/**
 * String literal union of every named exit-code kind. Derived from
 * `EXIT_CODES` so the type stays in lock-step with the runtime catalog.
 */
export type ExitCodeKind = keyof typeof EXIT_CODES;

/**
 * Numeric union of every legal exit value the catalog produces.
 * Note this is the *catalog* range, not the full POSIX `0..255` range:
 * arbitrary numeric exit codes (used by `ExitCode.fromValue(...)` for
 * external scripts) are validated separately by
 * `InvalidExitCodeError`.
 */
export type CatalogedExitValue = (typeof EXIT_CODES)[ExitCodeKind];

/**
 * Value object representing the integer status with which the CLI
 * process will terminate.
 *
 * Two distinct ways to construct one:
 *   - `ExitCode.from(kind)` — the preferred path. Picks a code from the
 *     catalog by its semantic name, e.g.
 *     `ExitCode.from("lockedWorkspace")`.
 *   - `ExitCode.fromValue(n)` — the escape hatch. Used when the CLI
 *     wraps a sub-process whose own exit code we want to forward
 *     verbatim (e.g. `mcp-memoria server` exiting with whatever the
 *     MCP runtime returned). The numeric value MUST satisfy POSIX:
 *     a non-negative integer in `0..255`. Otherwise
 *     `InvalidExitCodeError` is raised.
 *
 * Invariants:
 * - `value` is a non-negative integer in `0..255` (POSIX 8-bit).
 * - When the instance was built via `ExitCode.from(kind)`, the
 *   `kind` getter returns the corresponding `ExitCodeKind`. When it
 *   was built via `ExitCode.fromValue(n)`, `kind` returns `null`
 *   (the numeric value carries no semantic name).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `ExitCode` instances are equal iff they share the same
 *   numeric `value`. `kind` is a label and does not participate in
 *   equality (an `ExitCode.fromValue(0)` and an
 *   `ExitCode.from("success")` represent the same process outcome
 *   from the operating-system's point of view).
 */
export class ExitCode {
  /**
   * POSIX-mandated upper bound on exit statuses. Values above this
   * threshold are wrapped modulo 256 by the kernel and lose their
   * meaning; we refuse them here instead.
   */
  private static readonly MAX_POSIX_VALUE = 255;

  private constructor(
    public readonly value: number,
    public readonly kind: ExitCodeKind | null,
  ) {}

  /**
   * Builds an `ExitCode` from a named kind in the catalog. This is the
   * preferred factory; it both documents intent at the call site and
   * guarantees the numeric value is correct by construction.
   */
  public static from(kind: ExitCodeKind): ExitCode {
    return new ExitCode(EXIT_CODES[kind], kind);
  }

  /**
   * Builds an `ExitCode` from an arbitrary integer. Used for cases
   * where the CLI forwards the exit value of a child process. The
   * value is validated against the POSIX range; if it matches a known
   * catalog entry, the `kind` getter returns the corresponding name,
   * otherwise `null`.
   */
  public static fromValue(value: number): ExitCode {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new InvalidExitCodeError(value);
    }
    if (value < 0 || value > ExitCode.MAX_POSIX_VALUE) {
      throw new InvalidExitCodeError(value);
    }
    return new ExitCode(value, ExitCode.kindForValue(value));
  }

  /**
   * Convenience factory for the most common case (`process.exit(0)`).
   */
  public static success(): ExitCode {
    return ExitCode.from("success");
  }

  public isSuccess(): boolean {
    return this.value === EXIT_CODES.success;
  }

  public isFailure(): boolean {
    return this.value !== EXIT_CODES.success;
  }

  /**
   * Returns the numeric value suitable for `process.exit(...)`.
   */
  public toNumber(): number {
    return this.value;
  }

  public equals(other: ExitCode): boolean {
    return this.value === other.value;
  }

  // -- internals -----------------------------------------------------------

  /**
   * Looks up the catalog entry whose numeric value matches `value`.
   * Returns the kind if any, `null` otherwise. The lookup is a linear
   * scan over a tiny constant catalog; no need for a reverse map.
   */
  private static kindForValue(value: number): ExitCodeKind | null {
    const keys = Object.keys(EXIT_CODES) as readonly ExitCodeKind[];
    for (const key of keys) {
      if (EXIT_CODES[key] === value) return key;
    }
    return null;
  }
}
