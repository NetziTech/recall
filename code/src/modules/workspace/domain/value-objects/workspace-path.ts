import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing the absolute filesystem path to the root of
 * a host project (the directory that contains, or will contain, the
 * `.recall/` folder).
 *
 * The auto-detection algorithm in `docs/01-arquitectura.md` §4 walks the
 * directory tree upwards from `cwd` looking for known markers
 * (`.recall`, `.git`, `package.json`, etc.) and returns the first
 * match. The resulting path is what this VO wraps.
 *
 * Invariants:
 * - The wrapped value is non-empty after trimming.
 * - The wrapped value does NOT end with a trailing path separator
 *   (`/` on POSIX, `\` on Windows). This guarantees consumers can
 *   compose sub-paths with a single canonical separator without
 *   accidentally producing `//` or `\\` segments. The factory removes
 *   trailing separators (but never strips the lone root, e.g. `/` or
 *   `C:\`).
 * - The wrapped value MUST look absolute. The check is intentionally
 *   conservative and accepts both POSIX (`/foo`) and Windows
 *   (`C:\foo`, `\\server\share\foo`) shapes. We do NOT canonicalize the
 *   path (no `..` resolution, no symlink walk): canonicalization is an
 *   I/O concern and lives in the infrastructure adapter.
 * - The factory does NOT verify the path exists on disk. Existence is a
 *   runtime concern delegated to `WorkspaceDetector` adapters.
 *
 * Equality:
 * - Two `WorkspacePath` instances are equal iff their canonical strings
 *   match character-for-character. We do not normalize case on
 *   case-insensitive filesystems (Windows, default macOS HFS+) because
 *   the domain has no reliable way to know the FS semantics; adapters
 *   that need case-insensitive comparison should normalize before
 *   wrapping.
 */
export class WorkspacePath {
  private constructor(public readonly value: string) {}

  /**
   * Builds a `WorkspacePath`. Validates non-emptiness, the absence of a
   * trailing separator (stripping it if present and the path is not
   * just the root), and the "looks absolute" rule.
   */
  public static create(raw: string): WorkspacePath {
    if (typeof raw !== "string") {
      throw new InvalidInputError("workspace path must be a string", {
        field: "path",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("workspace path must not be empty", {
        field: "path",
      });
    }
    if (trimmed.includes("\0")) {
      throw new InvalidInputError(
        "workspace path must not contain NUL bytes",
        { field: "path" },
      );
    }
    if (!WorkspacePath.looksAbsolute(trimmed)) {
      throw new InvalidInputError(
        `workspace path must be absolute (got: "${raw}")`,
        { field: "path" },
      );
    }
    const canonical = WorkspacePath.stripTrailingSeparator(trimmed);
    return new WorkspacePath(canonical);
  }

  /**
   * Builds a child path under this workspace path. Pure string
   * composition; the caller is responsible for ensuring the segment is
   * relative and well-formed (the domain does no I/O and does no path
   * traversal protection — that lives in the infrastructure adapter
   * that ultimately touches the filesystem, see
   * `docs/01-arquitectura.md` §9).
   */
  public join(relativeSegment: string): WorkspacePath {
    if (typeof relativeSegment !== "string") {
      throw new InvalidInputError(
        "relative segment must be a string",
        { field: "segment" },
      );
    }
    const trimmed = relativeSegment.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "relative segment must not be empty",
        { field: "segment" },
      );
    }
    if (trimmed.includes("\0")) {
      throw new InvalidInputError(
        "relative segment must not contain NUL bytes",
        { field: "segment" },
      );
    }
    const separator = WorkspacePath.preferredSeparator(this.value);
    const cleanedSegment = WorkspacePath.stripLeadingSeparator(trimmed);
    const joined = `${this.value}${separator}${cleanedSegment}`;
    return new WorkspacePath(WorkspacePath.stripTrailingSeparator(joined));
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: WorkspacePath): boolean {
    return this.value === other.value;
  }

  /**
   * Returns true for POSIX absolute paths (`/...`), Windows drive paths
   * (`C:\...`, `C:/...`) and Windows UNC shares (`\\server\share\...`).
   * Anything else is considered relative.
   */
  private static looksAbsolute(candidate: string): boolean {
    if (candidate.length === 0) return false;
    // POSIX root.
    if (candidate.startsWith("/")) return true;
    // Windows UNC: `\\server\share\...` or `//server/share/...`.
    if (candidate.startsWith("\\\\") || candidate.startsWith("//")) return true;
    // Windows drive letter: `[A-Za-z]:[\\/]`.
    if (candidate.length >= 3) {
      const drive = candidate.charAt(0);
      const isLetter =
        (drive >= "A" && drive <= "Z") || (drive >= "a" && drive <= "z");
      const colon = candidate.charAt(1);
      const sep = candidate.charAt(2);
      if (isLetter && colon === ":" && (sep === "\\" || sep === "/")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Removes a trailing `/` or `\` from the path unless the path is just
   * the root itself (`/`, `C:\`, `C:/`, `\\server\share`).
   */
  private static stripTrailingSeparator(candidate: string): string {
    if (candidate.length <= 1) return candidate;
    const last = candidate.charAt(candidate.length - 1);
    if (last !== "/" && last !== "\\") return candidate;
    // Preserve POSIX root `/`.
    if (candidate === "/") return candidate;
    // Preserve Windows drive root, e.g. `C:\` or `C:/`.
    if (
      candidate.length === 3 &&
      candidate.charAt(1) === ":" &&
      (candidate.charAt(2) === "\\" || candidate.charAt(2) === "/")
    ) {
      return candidate;
    }
    return candidate.slice(0, -1);
  }

  private static stripLeadingSeparator(candidate: string): string {
    let cursor = 0;
    while (
      cursor < candidate.length &&
      (candidate.charAt(cursor) === "/" || candidate.charAt(cursor) === "\\")
    ) {
      cursor += 1;
    }
    return candidate.slice(cursor);
  }

  /**
   * Picks the path separator most consistent with the current path's
   * style. Windows-shaped paths get `\`, everything else gets `/`.
   */
  private static preferredSeparator(parent: string): "/" | "\\" {
    if (parent.startsWith("\\\\")) return "\\";
    if (
      parent.length >= 3 &&
      parent.charAt(1) === ":" &&
      (parent.charAt(2) === "\\" || parent.charAt(2) === "/")
    ) {
      return parent.charAt(2) === "\\" ? "\\" : "/";
    }
    return "/";
  }
}
