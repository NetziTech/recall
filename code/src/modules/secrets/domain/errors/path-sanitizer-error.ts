import { SecretsDomainError } from "./secrets-domain-error.ts";

/**
 * Set of legal `PathSanitizerErrorKind` values. Single source of truth
 * for the union below — adding a new failure mode is a one-line change
 * here. Mirrors the `as const` pattern used across the codebase
 * (`WorkspaceModeKind`, `DecisionStatusKind`, ...).
 *
 * The kinds are deliberately coarse because the path sanitizer is a
 * defensive layer (`docs/11-seguridad-modos.md` §6 — "Capa 2 — Path
 * sanitizer"): the goal is to refuse any path the domain cannot prove is
 * safe, not to report exhaustive parser diagnostics.
 *
 * - `path-traversal`: the input contains a `..` segment that would let
 *   the caller escape the workspace root.
 * - `absolute-path-not-allowed`: the input is an absolute path in a
 *   context where only relative paths may flow (e.g. log lines that the
 *   sanitizer must rewrite to `~/...` form).
 * - `invalid-separator`: the input mixes separators (`a/b\c`) in a way
 *   that prevents canonicalisation, or contains a NUL byte.
 * - `empty-path`: the input is empty or only whitespace.
 */
const PATH_SANITIZER_ERROR_KINDS = [
  "path-traversal",
  "absolute-path-not-allowed",
  "invalid-separator",
  "empty-path",
] as const;

export type PathSanitizerErrorKind =
  (typeof PATH_SANITIZER_ERROR_KINDS)[number];

/**
 * Raised when `PathSanitizerRule.apply(...)` (or any other path
 * sanitisation step in the secrets bounded context) refuses the input.
 *
 * The error is a Result-channel value: `PathSanitizerRule.apply` returns
 * `Result<SanitizedPath, PathSanitizerError>` rather than throwing,
 * because path-sanitisation failures are an expected, recoverable
 * outcome. Callers branch on the kind to surface a precise message to
 * the user (`docs/11-seguridad-modos.md` §6 — "Capa 4 — Pre-commit hook
 * opcional" requires actionable error messages).
 *
 * Invariants:
 * - `code` is the stable identifier `secrets.path-sanitizer`.
 * - `kind` is one of the values in `PATH_SANITIZER_ERROR_KINDS`. The
 *   discriminator lets callers branch exhaustively (a switch with
 *   `default: never` will compile-error if a new kind is added without
 *   updating the consumer).
 * - `rawPath` echoes the offending input verbatim so adapters can
 *   surface it in a message; the value is NOT redacted because path
 *   sanitisation runs *before* secret detection, so the path itself is
 *   not yet considered confidential.
 * - `jsonRpcCode` is `null`: the protocol catalog
 *   (`docs/02-protocolo-mcp.md` §6) does not allocate a project-specific
 *   code for "path rejected by sanitiser". Adapters typically map this
 *   to the standard JSON-RPC `INVALID_PARAMS` (-32602) or expose
 *   `code` directly in `error.data.domain_code`.
 */
export class PathSanitizerError extends SecretsDomainError {
  public readonly code = "secrets.path-sanitizer";
  public readonly jsonRpcCode: number | null = null;
  public readonly kind: PathSanitizerErrorKind;
  public readonly rawPath: string;

  public constructor(input: {
    kind: PathSanitizerErrorKind;
    rawPath: string;
    cause?: unknown;
  }) {
    super(
      PathSanitizerError.buildMessage(input.kind, input.rawPath),
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.kind = input.kind;
    this.rawPath = input.rawPath;
  }

  /**
   * Type guard exposed for callers that need to validate raw strings
   * without instantiating the error (e.g. fast-path checks at the
   * boundary).
   */
  public static isKind(candidate: string): candidate is PathSanitizerErrorKind {
    for (const known of PATH_SANITIZER_ERROR_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Builds a deterministic, English-language message per kind. The
   * message intentionally avoids quoting the raw path (kept on the
   * `rawPath` field) so log aggregators can group occurrences without
   * the path entering the message text.
   */
  private static buildMessage(
    kind: PathSanitizerErrorKind,
    rawPath: string,
  ): string {
    switch (kind) {
      case "path-traversal":
        return `path sanitizer refused traversal segment ".." in input (length: ${String(rawPath.length)})`;
      case "absolute-path-not-allowed":
        return `path sanitizer refused absolute path in a relative-only context (length: ${String(rawPath.length)})`;
      case "invalid-separator":
        return `path sanitizer refused input with invalid or mixed separators (length: ${String(rawPath.length)})`;
      case "empty-path":
        return `path sanitizer refused empty or whitespace-only input`;
      default: {
        // Exhaustiveness guard: the union is closed, so this branch is
        // unreachable. The `never` cast forces a compile error if a new
        // kind is added without updating the switch.
        const exhaustive: never = kind;
        return `path sanitizer refused unknown failure kind: ${String(exhaustive)}`;
      }
    }
  }
}
