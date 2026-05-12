import {
  err,
  ok,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import { PathSanitizerError } from "../errors/path-sanitizer-error.ts";
import { SanitizedPath } from "./sanitized-path.ts";

/**
 * Set of legal `PathSanitizerPolicyKind` values. Single source of truth
 * for the union below.
 *
 * The policy controls how strict the rule is about absolute paths:
 *
 * - `relative-only`: absolute paths are rejected outright. Used by
 *   contexts where only workspace-relative paths can flow (e.g. the
 *   `files_touched` slot of a turn — `docs/03-modelo-datos.md` §4.2).
 * - `tilde-rewrite`: absolute paths are accepted and rewritten by
 *   collapsing the `/Users/<name>` (POSIX) or `C:\Users\<name>`
 *   (Windows) prefix to `~`. Used by the Capa 2 path sanitiser
 *   (`docs/11-seguridad-modos.md` §6) when scanning free-form text.
 *
 * Both policies always reject:
 * - empty/whitespace input;
 * - inputs containing a NUL byte;
 * - inputs containing a `..` segment (path traversal).
 */
const PATH_SANITIZER_POLICY_KINDS = ["relative-only", "tilde-rewrite"] as const;

export type PathSanitizerPolicyKind =
  (typeof PATH_SANITIZER_POLICY_KINDS)[number];

/**
 * Maximum length, in characters, of a raw path the rule will accept
 * before it even attempts to canonicalise. Mirrors the cap on
 * `SanitizedPath` so the boundary is consistent across both VOs.
 */
const MAX_RAW_PATH_LENGTH = 4096;

/**
 * Value object encapsulating ONE path-sanitisation policy.
 *
 * The rule is the in-domain representation of the path-sanitiser layer
 * documented in `docs/11-seguridad-modos.md` §6 ("Capa 2 — Path
 * sanitizer"). It owns the policy ("how strict are we about absolute
 * paths?") AND the canonicalisation algorithm ("how do we rewrite a
 * `/Users/foo/...` path?"), but it does NOT own the platform-specific
 * details that belong to infrastructure (e.g. real-fs symlink walking).
 *
 * The rule is configured with the *user* segment of the host filesystem
 * (`/Users/<userSegment>`), so the same rule object can be reused
 * across many `apply(...)` calls without leaking the user identity
 * into rejected outputs.
 *
 * `apply(...)` returns a `Result` because rejection is an expected
 * outcome callers must handle explicitly: a path coming from user
 * input may legitimately fail the rule, and the application layer
 * branches on the kind of failure to surface a precise message.
 *
 * Invariants:
 * - The wrapped `policy` is one of `PATH_SANITIZER_POLICY_KINDS`.
 * - `userSegment` is non-empty and contains no separators or NUL
 *   bytes when present (it is `null` when the rule is configured
 *   without a user identity, in which case `tilde-rewrite` is a no-op
 *   for `/Users/...`-style paths).
 *
 * Equality:
 * - Two rules are equal iff `policy` AND `userSegment` match.
 */
export class PathSanitizerRule {
  private constructor(
    public readonly policy: PathSanitizerPolicyKind,
    public readonly userSegment: string | null,
  ) {}

  /**
   * Convenience factory for the strictest policy: refuse anything that
   * looks absolute. Used by callers that exclusively accept
   * workspace-relative paths.
   */
  public static relativeOnly(): PathSanitizerRule {
    return new PathSanitizerRule("relative-only", null);
  }

  /**
   * Convenience factory for the rewriting policy: accept absolute
   * paths and collapse `/Users/<userSegment>` (or
   * `C:\Users\<userSegment>`, etc.) to `~`. The `userSegment`
   * argument names the host user; passing `null` disables the rewrite
   * (the rule still strips other transformations).
   */
  public static tildeRewrite(userSegment: string | null): PathSanitizerRule {
    if (userSegment !== null) {
      const trimmed = userSegment.trim();
      if (trimmed.length === 0) {
        // Empty user segment is treated as "no rewrite available" —
        // safer than allowing an empty-string match that would
        // collapse `/Users//foo` to `~/foo`, leaking the absolute
        // structure.
        return new PathSanitizerRule("tilde-rewrite", null);
      }
      if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
        return new PathSanitizerRule("tilde-rewrite", null);
      }
      return new PathSanitizerRule("tilde-rewrite", trimmed);
    }
    return new PathSanitizerRule("tilde-rewrite", null);
  }

  /**
   * Type guard exposed for callers that need to validate raw policy
   * strings without instantiating the rule.
   */
  public static isPolicy(candidate: string): candidate is PathSanitizerPolicyKind {
    for (const known of PATH_SANITIZER_POLICY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Applies the rule to `rawPath`.
   *
   * Returns `ok(SanitizedPath)` on success, or
   * `err(PathSanitizerError)` describing the rejection reason.
   * Rejection is the *expected* failure mode for invalid input — never
   * an exception — so the application layer can branch on
   * `result.kind` exhaustively.
   *
   * The algorithm:
   * 1. Reject empty or whitespace-only input (`empty-path`).
   * 2. Reject NUL bytes (`invalid-separator`).
   * 3. Reject `..` segments anywhere in the path (`path-traversal`).
   * 4. If the path looks absolute and the policy is `relative-only`,
   *    reject (`absolute-path-not-allowed`).
   * 5. If the path looks absolute and the policy is `tilde-rewrite`,
   *    apply the rewrite and continue.
   * 6. Wrap the canonical form in `SanitizedPath`.
   *
   * The rule does NOT touch the filesystem: no `lstat`, no symlink
   * resolution, no existence check. Those concerns live in the
   * infrastructure adapter that *uses* a sanitised path.
   */
  public apply(rawPath: string): Result<SanitizedPath, PathSanitizerError> {
    if (typeof rawPath !== "string") {
      return err(
        new PathSanitizerError({
          kind: "empty-path",
          rawPath: String(rawPath),
        }),
      );
    }
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      return err(
        new PathSanitizerError({ kind: "empty-path", rawPath }),
      );
    }
    if (trimmed.length > MAX_RAW_PATH_LENGTH) {
      // Oversized paths are reported as separator-invalid: the rule
      // refuses to canonicalise them, and the failure surface is
      // already enumerated. Adding a dedicated kind would create a
      // case the caller must branch on without offering new
      // information.
      return err(
        new PathSanitizerError({ kind: "invalid-separator", rawPath }),
      );
    }
    if (trimmed.includes("\0")) {
      return err(
        new PathSanitizerError({ kind: "invalid-separator", rawPath }),
      );
    }
    if (PathSanitizerRule.containsTraversalSegment(trimmed)) {
      return err(
        new PathSanitizerError({ kind: "path-traversal", rawPath }),
      );
    }
    const looksAbsolute = PathSanitizerRule.looksAbsolute(trimmed);
    if (looksAbsolute && this.policy === "relative-only") {
      return err(
        new PathSanitizerError({
          kind: "absolute-path-not-allowed",
          rawPath,
        }),
      );
    }
    const canonical = looksAbsolute
      ? this.rewriteAbsolute(trimmed)
      : trimmed;
    try {
      return ok(SanitizedPath.create(canonical));
    } catch (cause) {
      return err(
        new PathSanitizerError(
          {
            kind: "invalid-separator",
            rawPath,
          },
          cause,
        ),
      );
    }
  }

  public equals(other: PathSanitizerRule): boolean {
    if (this === other) return true;
    return this.policy === other.policy && this.userSegment === other.userSegment;
  }

  /**
   * Rewrites a known absolute path into its `~`-prefixed form when the
   * rule has a `userSegment` configured. Falls back to returning the
   * input verbatim when no rewrite applies.
   *
   * The implementation handles the three shapes called out in
   * `docs/11-seguridad-modos.md` §6:
   *  - `/Users/<userSegment>/...`  (macOS)
   *  - `/home/<userSegment>/...`   (Linux)
   *  - `C:\Users\<userSegment>\...` (Windows)
   */
  private rewriteAbsolute(absolute: string): string {
    if (this.userSegment === null) return absolute;
    const macPrefix = `/Users/${this.userSegment}`;
    if (absolute === macPrefix) return "~";
    if (absolute.startsWith(`${macPrefix}/`)) {
      return `~${absolute.slice(macPrefix.length)}`;
    }
    const linuxPrefix = `/home/${this.userSegment}`;
    if (absolute === linuxPrefix) return "~";
    if (absolute.startsWith(`${linuxPrefix}/`)) {
      return `~${absolute.slice(linuxPrefix.length)}`;
    }
    const winLowerPrefix = `c:\\Users\\${this.userSegment}`;
    const winUpperPrefix = `C:\\Users\\${this.userSegment}`;
    if (absolute === winUpperPrefix || absolute === winLowerPrefix) return "~";
    if (absolute.startsWith(`${winUpperPrefix}\\`)) {
      return `~${absolute.slice(winUpperPrefix.length)}`;
    }
    if (absolute.startsWith(`${winLowerPrefix}\\`)) {
      return `~${absolute.slice(winLowerPrefix.length)}`;
    }
    return absolute;
  }

  /**
   * Same shape-test used by `WorkspacePath`. Kept duplicated here on
   * purpose: the secrets module is independent and importing the
   * workspace VO would violate the cross-module rule
   * (`docs/12-lineamientos-arquitectura.md` §1.5 Regla 2).
   *
   * If a third module ever needs the same check, it would justify
   * promoting it to `shared/domain/`.
   */
  private static looksAbsolute(candidate: string): boolean {
    if (candidate.length === 0) return false;
    if (candidate.startsWith("/")) return true;
    if (candidate.startsWith("\\\\") || candidate.startsWith("//")) return true;
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
   * True iff the path contains a `..` segment delimited by either
   * separator (matches the implementation in `SanitizedPath`).
   */
  private static containsTraversalSegment(candidate: string): boolean {
    const segments = candidate.split(/[/\\]/);
    for (const segment of segments) {
      if (segment === "..") return true;
    }
    return false;
  }
}
