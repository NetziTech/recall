import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `WorkspaceModeKind` values. The array is the single
 * source of truth: the `WorkspaceModeKind` union below is derived from
 * its element type, so adding a new mode is a one-line change here and
 * the union updates automatically. Avoids the previous duplication
 * between a hand-written union literal and a separate validation array
 * (which could drift if a new variant was added to one but not the
 * other). Mirrors the pattern used in `JsonRpcErrorCodes`.
 */
const WORKSPACE_MODE_KINDS = ["shared", "encrypted", "private"] as const;

/**
 * Discriminated union of the three privacy modes a workspace can adopt.
 *
 * The literal values are the canonical wire format used everywhere in
 * the system: `.mcp-memoria/config.json → mode`, JSON-RPC payloads,
 * audit log entries, etc. (see `docs/11-seguridad-modos.md` §1 for the
 * full taxonomy).
 */
export type WorkspaceModeKind = (typeof WORKSPACE_MODE_KINDS)[number];

/**
 * Value object representing the privacy mode of a workspace.
 *
 * The mode determines (a) whether the `.mcp-memoria/` directory is
 * versioned in git, (b) whether SQLCipher is layered on top of the SQLite
 * databases, and (c) whether the runtime requires an unlock step before
 * any read/write. The semantics are documented in
 * `docs/11-seguridad-modos.md` §§1-4 and summarized in
 * `docs/01-arquitectura.md` §2.3.
 *
 * Invariants:
 * - The wrapped `kind` is always one of `"shared" | "encrypted" |
 *   "private"`. Anything else is rejected at the factory boundary.
 * - Instances are immutable. Mode changes happen at the aggregate level
 *   (`Workspace.changeMode(...)`) and produce new `WorkspaceMode`
 *   instances; this VO never mutates in place.
 *
 * Equality:
 * - Two `WorkspaceMode` instances are equal iff they share the same
 *   `kind`. There are no other distinguishing attributes.
 */
export class WorkspaceMode {
  private constructor(public readonly kind: WorkspaceModeKind) {}

  /**
   * Builds a `WorkspaceMode` from an arbitrary string. Used when reading
   * `config.json` or decoding JSON-RPC arguments. Whitespace is
   * tolerated (trimmed) but case is significant: the canonical form is
   * lowercase to match the storage format.
   */
  public static create(raw: string): WorkspaceMode {
    if (typeof raw !== "string") {
      throw new InvalidInputError("workspace mode must be a string", {
        field: "mode",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("workspace mode must not be empty", {
        field: "mode",
      });
    }
    if (!WorkspaceMode.isKind(trimmed)) {
      throw new InvalidInputError(
        `workspace mode must be one of "shared" | "encrypted" | "private" (got: "${raw}")`,
        { field: "mode" },
      );
    }
    return new WorkspaceMode(trimmed);
  }

  /**
   * Convenience factory for the default `shared` mode.
   *
   * The three convenience factories use the `Mode` suffix uniformly
   * (`sharedMode`, `encryptedMode`, `privateMode`) so the API is
   * symmetric. The suffix is required for `privateMode` because
   * `private` is a reserved word in TypeScript class context, and we
   * apply it to the other two to keep the surface consistent rather
   * than mixing styles.
   */
  public static sharedMode(): WorkspaceMode {
    return new WorkspaceMode("shared");
  }

  /** Convenience factory for the encrypted mode. */
  public static encryptedMode(): WorkspaceMode {
    return new WorkspaceMode("encrypted");
  }

  /** Convenience factory for the private (gitignored) mode. */
  public static privateMode(): WorkspaceMode {
    return new WorkspaceMode("private");
  }

  /**
   * Type guard used internally and exposed for callers that need to
   * validate raw strings without instantiating the VO (e.g. zod
   * refinements in the application layer).
   */
  public static isKind(candidate: string): candidate is WorkspaceModeKind {
    for (const known of WORKSPACE_MODE_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isShared(): boolean {
    return this.kind === "shared";
  }

  public isEncrypted(): boolean {
    return this.kind === "encrypted";
  }

  public isPrivate(): boolean {
    return this.kind === "private";
  }

  /**
   * True iff this mode requires an encryption key to perform any
   * read/write. Currently only `encrypted` does; `shared` and `private`
   * operate on plaintext SQLite databases (the privacy of `private` is
   * delivered by `.gitignore`, not by cryptography).
   */
  public requiresKey(): boolean {
    return this.kind === "encrypted";
  }

  public toString(): WorkspaceModeKind {
    return this.kind;
  }

  public equals(other: WorkspaceMode): boolean {
    return this.kind === other.kind;
  }
}
