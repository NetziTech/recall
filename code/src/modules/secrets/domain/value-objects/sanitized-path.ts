import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Maximum length, in characters, of the canonicalised path string.
 *
 * Mirrors the cap used by `SecretSource.filePath` so an upstream source
 * and its sanitised counterpart can carry the same value without
 * truncation surprises.
 */
const MAX_SANITIZED_PATH_LENGTH = 4096;

/**
 * Value object wrapping the *result* of running `PathSanitizerRule` on
 * a raw path.
 *
 * The sanitised path is the canonical form the rest of the system uses
 * for diagnostics and audit logs (`docs/11-seguridad-modos.md` §6 —
 * "Capa 2 — Path sanitizer" rewrites absolute paths to `~/...` form
 * and to workspace-relative form when applicable). The VO does NOT
 * verify the path exists on disk: existence is an I/O concern handled
 * by infrastructure adapters.
 *
 * Invariants:
 * - The wrapped value is non-empty.
 * - The wrapped value is at most `MAX_SANITIZED_PATH_LENGTH`
 *   characters.
 * - The wrapped value contains no NUL bytes (a defence-in-depth check
 *   that prevents NUL-truncation tricks downstream).
 * - The wrapped value contains no `..` segment. The path sanitiser is
 *   the only legitimate way to obtain a `SanitizedPath`, and it
 *   refuses traversal segments — so any `..` here would be an
 *   invariant breach (the factory rejects it as a defence-in-depth
 *   second line of defence).
 *
 * Equality:
 * - Two `SanitizedPath` instances are equal iff their canonical strings
 *   match character-for-character. We do not normalize case; adapters
 *   that target case-insensitive filesystems must normalize before
 *   wrapping.
 */
export class SanitizedPath {
  private constructor(public readonly value: string) {}

  /**
   * Builds a `SanitizedPath`. Intended to be called only by the path
   * sanitiser (which lives in infrastructure) once it has produced the
   * canonical form. The factory still validates the invariants so a
   * misbehaving adapter cannot inject a `..` or a NUL byte.
   */
  public static create(value: string): SanitizedPath {
    if (typeof value !== "string") {
      throw new InvalidInputError("sanitized path must be a string", {
        field: "path",
      });
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("sanitized path must not be empty", {
        field: "path",
      });
    }
    if (trimmed.length > MAX_SANITIZED_PATH_LENGTH) {
      throw new InvalidInputError(
        `sanitized path must be at most ${String(MAX_SANITIZED_PATH_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "path" },
      );
    }
    if (trimmed.includes("\0")) {
      throw new InvalidInputError(
        "sanitized path must not contain NUL bytes",
        { field: "path" },
      );
    }
    if (SanitizedPath.containsTraversalSegment(trimmed)) {
      throw new InvalidInputError(
        "sanitized path must not contain '..' traversal segments",
        { field: "path" },
      );
    }
    return new SanitizedPath(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public length(): number {
    return this.value.length;
  }

  public equals(other: SanitizedPath): boolean {
    if (this === other) return true;
    return this.value === other.value;
  }

  /**
   * True iff the path contains a `..` segment delimited by either
   * separator. The check is purely textual: it splits on `/` and `\`
   * and looks for an exact `..` token. This catches `..`, `a/../b`,
   * `..\\b`, etc., without flagging filenames that merely contain a
   * dot pair (e.g. `foo..bar`).
   */
  private static containsTraversalSegment(candidate: string): boolean {
    const segments = candidate.split(/[/\\]/);
    for (const segment of segments) {
      if (segment === "..") return true;
    }
    return false;
  }
}
