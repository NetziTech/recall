import { UnknownCommandError } from "../errors/unknown-command-error.ts";

/**
 * Single source of truth for the catalog of CLI sub-commands the
 * `mcp-memoria` binary exposes. Mirrors the table in
 * `docs/07-instalacion.md` §7.
 *
 * The order in this array drives the order in which `--help` lists the
 * commands (the application layer is free to reorder for display, but
 * domain comparisons rely only on set membership). Every literal here is
 * a stable public contract: removing or renaming an entry is a breaking
 * change for end users and for any documentation that references the
 * command.
 *
 * Pattern note: the list is declared `as const` so the `CommandNameValue`
 * type below is derived automatically. Adding a new command is a
 * one-line edit here. The same pattern is used in
 * `WORKSPACE_MODE_KINDS` (workspace module) and in `JsonRpcErrorCodes`
 * (shared/domain).
 */
const COMMAND_NAMES = [
  // Initialisation / mode
  "init",
  "mode",
  // Encryption key lifecycle
  "unlock",
  "forget-key",
  "export-key",
  "rekey",
  "add-key",
  // Maintenance
  "audit",
  "sanitize",
  "curator-run",
  "curator-log",
  // Migration
  "import-handoff",
  // Backup / restore
  "export",
  "import",
  "wipe",
  // Hooks
  "install-hook",
  "uninstall-hook",
  // Stats / health
  "stats",
  "health",
  // Server entry-point (invoked by MCP clients, not humans)
  "server",
] as const;

/**
 * String literal union of every legal CLI sub-command. Derived from
 * `COMMAND_NAMES` so the type stays in lock-step with the runtime list.
 */
export type CommandNameValue = (typeof COMMAND_NAMES)[number];

/**
 * Value object representing the *identity* of a CLI sub-command (the
 * token that follows `mcp-memoria` in argv).
 *
 * The class deliberately carries no behaviour beyond:
 *   - validating that the raw token is one of the known commands;
 *   - exposing the canonical literal as `value`;
 *   - implementing `equals(...)` for use in dispatch tables.
 *
 * Anything richer (which arguments each command accepts, which use case
 * each one drives, the help text, etc.) lives in the application layer:
 * the domain only needs to know "is this string a recognised command?".
 *
 * Invariants:
 * - The wrapped `value` is always a member of `COMMAND_NAMES`. Anything
 *   else is rejected at the factory boundary with `UnknownCommandError`.
 * - Whitespace around the input is trimmed; case is significant (the
 *   canonical form is lowercase to match `docs/07-instalacion.md`).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `CommandName` instances are equal iff they share the same
 *   `value`.
 */
export class CommandName {
  private constructor(public readonly value: CommandNameValue) {}

  /**
   * Builds a `CommandName` from an arbitrary string. Used by the
   * application-layer parser when handling argv. Whitespace is trimmed;
   * case is significant.
   *
   * Throws `UnknownCommandError` if `raw` is not a string or does not
   * match any known command. The error preserves the *original* token
   * (untrimmed) so the message echoes exactly what the user typed.
   */
  public static create(raw: string): CommandName {
    if (typeof raw !== "string") {
      throw new UnknownCommandError(String(raw));
    }
    const trimmed = raw.trim();
    if (!CommandName.isValue(trimmed)) {
      throw new UnknownCommandError(raw);
    }
    return new CommandName(trimmed);
  }

  /**
   * Type guard exposed so callers (e.g. application-layer parsers using
   * Zod refinements) can validate raw strings without instantiating the
   * VO.
   */
  public static isValue(candidate: string): candidate is CommandNameValue {
    for (const known of COMMAND_NAMES) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Read-only view over the catalog. The application / infrastructure
   * layers use this to build help output and dispatch tables without
   * reaching into the underlying `as const` array. Returning a fresh
   * shallow copy each call keeps callers from mutating the SSOT.
   */
  public static all(): readonly CommandNameValue[] {
    return Object.freeze([...COMMAND_NAMES]);
  }

  public toString(): CommandNameValue {
    return this.value;
  }

  public equals(other: CommandName): boolean {
    return this.value === other.value;
  }
}
