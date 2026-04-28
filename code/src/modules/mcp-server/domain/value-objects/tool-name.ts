import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `ToolNameKind` values: the six MVP tools enumerated in
 * `docs/02-protocolo-mcp.md` §2 ("MVP — 6 tools"). The array is the
 * single source of truth: the `ToolNameKind` union below is derived
 * from its element type, so adding a new tool is a one-line change
 * here and the union updates automatically.
 *
 * Each literal carries the canonical wire prefix `"mem."` documented in
 * `docs/02-protocolo-mcp.md` §1 ("Convenciones — Prefijo: todas las
 * tools con `mem.` para evitar choques con otros MCPs").
 */
const TOOL_NAME_KINDS = [
  "mem.init",
  "mem.context",
  "mem.recall",
  "mem.remember",
  "mem.task",
  "mem.health",
] as const;

export type ToolNameKind = (typeof TOOL_NAME_KINDS)[number];

/**
 * Value object representing the canonical name of a tool exposed by the
 * MCP server.
 *
 * The wire format (`"mem.<verb>"`) is the contract clients use to call
 * the server (see `docs/02-protocolo-mcp.md` §2). Modelling it as a VO
 * gives us:
 * - A choke-point that rejects unknown / typo'd tool names at the
 *   domain boundary instead of letting them propagate into the
 *   dispatcher as silent `method_not_found`s.
 * - A typed identity for `ToolRegistration` so the registry cannot mix
 *   names from different sources.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the six MVP literals.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `ToolName` instances are equal iff they share the same `kind`.
 *
 * Note on scope:
 * - The v0.5 catalog (`docs/02-protocolo-mcp.md` §3) is intentionally
 *   *not* included here. Adding a tool is a deliberate domain change —
 *   the whole point of this VO is to refuse names the protocol does
 *   not yet support.
 */
export class ToolName {
  private constructor(public readonly kind: ToolNameKind) {}

  /**
   * Builds a `ToolName` from an arbitrary string. Whitespace is
   * tolerated (trimmed) but case is significant: the canonical form is
   * lowercase to match the wire protocol.
   */
  public static create(raw: string): ToolName {
    if (typeof raw !== "string") {
      throw new InvalidInputError("tool name must be a string", {
        field: "tool_name",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("tool name must not be empty", {
        field: "tool_name",
      });
    }
    if (!ToolName.isKind(trimmed)) {
      throw new InvalidInputError(
        `tool name must be one of "mem.init" | "mem.context" | "mem.recall" | "mem.remember" | "mem.task" | "mem.health" (got: "${raw}")`,
        { field: "tool_name" },
      );
    }
    return new ToolName(trimmed);
  }

  /** Convenience factory for `mem.init`. */
  public static init(): ToolName {
    return new ToolName("mem.init");
  }

  /** Convenience factory for `mem.context`. */
  public static context(): ToolName {
    return new ToolName("mem.context");
  }

  /** Convenience factory for `mem.recall`. */
  public static recall(): ToolName {
    return new ToolName("mem.recall");
  }

  /** Convenience factory for `mem.remember`. */
  public static remember(): ToolName {
    return new ToolName("mem.remember");
  }

  /** Convenience factory for `mem.task`. */
  public static task(): ToolName {
    return new ToolName("mem.task");
  }

  /** Convenience factory for `mem.health`. */
  public static health(): ToolName {
    return new ToolName("mem.health");
  }

  /**
   * Type guard exposed for callers that need to validate raw strings
   * without instantiating the VO.
   */
  public static isKind(candidate: string): candidate is ToolNameKind {
    for (const known of TOOL_NAME_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns every legal tool name in declaration order. Useful for the
   * `ToolRegistry` bootstrap so the composition root does not need to
   * hard-code the list.
   */
  public static all(): readonly ToolName[] {
    const names: ToolName[] = [];
    for (const kind of TOOL_NAME_KINDS) {
      names.push(new ToolName(kind));
    }
    return Object.freeze(names);
  }

  public toString(): ToolNameKind {
    return this.kind;
  }

  public equals(other: ToolName): boolean {
    return this.kind === other.kind;
  }
}
