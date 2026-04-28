import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `ScopeKind` values. Mirrors the `scope` column on
 * `decisions`, `learnings`, ... documented in `docs/03-modelo-datos.md`
 * §4.3-§4.5 and the `mem.recall.scope` filter
 * (`docs/02-protocolo-mcp.md` §4.3).
 *
 * - `project`: applies to the whole project. The `module` slot is null.
 * - `module`: applies to a specific module. The `module` slot carries
 *   the module name (`docs/04-capas-contexto.md` §3.2 — "primero las
 *   marcadas `scope='project'`, luego `module` si la query menciona un
 *   modulo").
 */
const SCOPE_KINDS = ["project", "module"] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * Maximum length of a module identifier. Modules are short logical
 * names (`editor`, `commands`, `auth`, ...) — allowing more than 200
 * chars would let arbitrary text pollute the scope discriminator.
 */
const MAX_MODULE_LENGTH = 200;

/**
 * Internal shape of the scope value. Discriminated union: when `kind`
 * is `"project"`, `module` is forced to `null`; when `kind` is
 * `"module"`, `module` is a non-empty string.
 *
 * The shape is exported as a type alias because consumers (recall
 * filters, persistence adapters) need to pattern-match on it.
 */
export type ScopeValue =
  | { readonly kind: "project"; readonly module: null }
  | { readonly kind: "module"; readonly module: string };

/**
 * Value object representing the scope of a memory entry.
 *
 * Invariants:
 * - When `kind` is `"project"`, `module` is `null`.
 * - When `kind` is `"module"`, `module` is a trimmed, non-empty string
 *   no longer than `MAX_MODULE_LENGTH` characters.
 * - Instances are immutable; "changing" scope produces a new VO.
 *
 * Equality:
 * - Two scopes are equal iff their `kind` and `module` slots match
 *   character-for-character.
 */
export class Scope {
  private constructor(
    public readonly kind: ScopeKind,
    public readonly module: string | null,
  ) {}

  /**
   * Convenience factory for the default project-wide scope.
   */
  public static project(): Scope {
    return new Scope("project", null);
  }

  /**
   * Convenience factory for a module-scoped entry. The module name is
   * trimmed; an empty result is rejected.
   */
  public static module(moduleName: string): Scope {
    const trimmed = Scope.normalizeModule(moduleName);
    return new Scope("module", trimmed);
  }

  /**
   * Builds a `Scope` from raw inputs (typically from JSON-RPC). When
   * `kind === "module"`, `moduleName` MUST be provided and non-empty.
   * When `kind === "project"`, `moduleName` is ignored.
   */
  public static create(kind: string, moduleName: string | null): Scope {
    if (typeof kind !== "string") {
      throw new InvalidInputError("scope kind must be a string", {
        field: "scope",
      });
    }
    const trimmedKind = kind.trim();
    if (!Scope.isKind(trimmedKind)) {
      throw new InvalidInputError(
        `scope must be one of "project" | "module" (got: "${kind}")`,
        { field: "scope" },
      );
    }
    if (trimmedKind === "module") {
      if (typeof moduleName !== "string") {
        throw new InvalidInputError(
          'scope "module" requires a non-empty module name',
          { field: "module" },
        );
      }
      const trimmedName = Scope.normalizeModule(moduleName);
      return new Scope("module", trimmedName);
    }
    return new Scope("project", null);
  }

  public static isKind(candidate: string): candidate is ScopeKind {
    for (const known of SCOPE_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isProject(): boolean {
    return this.kind === "project";
  }

  public isModule(): boolean {
    return this.kind === "module";
  }

  /**
   * Returns the discriminated union view. Useful for adapters that need
   * to pattern-match without poking at the class internals.
   */
  public toValue(): ScopeValue {
    if (this.kind === "module") {
      // The constructor invariants guarantee `module` is a string when
      // `kind === "module"`; the assertion is structural and survives
      // strict null checks.
      const moduleName = this.module;
      if (moduleName === null) {
        // Defensive: the constructor never lets this happen, but we
        // narrow explicitly so the union remains sound.
        throw new InvalidInputError(
          'scope of kind "module" must carry a module name',
          { field: "module" },
        );
      }
      return { kind: "module", module: moduleName };
    }
    return { kind: "project", module: null };
  }

  public equals(other: Scope): boolean {
    if (this === other) return true;
    return this.kind === other.kind && this.module === other.module;
  }

  // -- internals ------------------------------------------------------------

  private static normalizeModule(raw: string): string {
    if (typeof raw !== "string") {
      throw new InvalidInputError(
        "module name must be a non-empty string",
        { field: "module" },
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "module name must contain at least one non-whitespace character",
        { field: "module" },
      );
    }
    if (trimmed.length > MAX_MODULE_LENGTH) {
      throw new InvalidInputError(
        `module name must be at most ${String(MAX_MODULE_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "module" },
      );
    }
    return trimmed;
  }
}
