import type { Result } from "../../../../shared/domain/types/result.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { SecretsScanner } from "../../domain/services/secrets-scanner.ts";
import type { SanitizedPath } from "../../domain/value-objects/sanitized-path.ts";
import type { SanitizePath } from "../ports/in/sanitize-path.port.ts";

/**
 * Use case: canonicalise a raw filesystem path.
 *
 * Thin pass-through over `SecretsScanner.scanPath(...)`. The split
 * exists because the input port `SanitizePath` is the stable
 * contract callers depend on; the underlying domain port may grow
 * (e.g. accepting a workspace-scoped policy) without breaking
 * consumers.
 *
 * Why no logging:
 * - Path sanitisation runs on the hot path (every `record_*` and
 *   every recall reference). Adding a per-call log entry would
 *   pollute the trail with no diagnostic value (rejections are
 *   already actionable via the typed `Result` channel; successful
 *   sanitisations carry no information worth logging at info level).
 *   Callers that need to trace a specific call site emit their own
 *   log entry.
 */
export class SanitizePathUseCase implements SanitizePath {
  public constructor(private readonly scanner: SecretsScanner) {}

  public sanitize(rawPath: string): Result<SanitizedPath, PathSanitizerError> {
    return this.scanner.scanPath(rawPath);
  }
}
