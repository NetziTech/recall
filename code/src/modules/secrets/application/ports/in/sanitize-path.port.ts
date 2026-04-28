import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { SanitizedPath } from "../../../domain/value-objects/sanitized-path.ts";
import type { PathSanitizerError } from "../../../domain/errors/path-sanitizer-error.ts";

/**
 * Driving (input) port: canonicalise a raw filesystem path according
 * to the project's path-sanitiser policy.
 *
 * Implements the "Capa 2 — Path sanitizer" flow documented in
 * `docs/11-seguridad-modos.md` §6. The use case picks the
 * appropriate `PathSanitizerRule` based on the workspace context
 * and returns either a `SanitizedPath` or a typed
 * `PathSanitizerError` describing why the input was refused.
 */
export interface SanitizePath {
  sanitize(rawPath: string): Result<SanitizedPath, PathSanitizerError>;
}
