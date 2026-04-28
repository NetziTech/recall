import type { Result } from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { PathSanitizerError } from "../errors/path-sanitizer-error.ts";
import type { SanitizedPath } from "../value-objects/sanitized-path.ts";
import type { SanitizedText } from "../value-objects/sanitized-text.ts";

/**
 * Driven port (output port) for the defence-in-depth secrets scanner.
 *
 * The concrete implementation (regex registry + Shannon entropy
 * calculator + path sanitiser) lives in `infrastructure/`. The domain
 * only knows the contract:
 *
 * - `scan(text, workspaceId)` runs every layer-1 detector
 *   (`docs/11-seguridad-modos.md` §6 — "Capa 1 — Pre-write detection")
 *   over `text`. The return is a `SanitizedText` that always contains
 *   the original input AND the sanitised form, even when no secret was
 *   found. The `findings` array enumerates every match in detection
 *   order. Calling `scan` is idempotent and side-effect free except for
 *   the implicit cost of regex execution.
 * - `scanPath(rawPath)` runs the layer-2 path sanitiser
 *   (`docs/11-seguridad-modos.md` §6 — "Capa 2 — Path sanitizer") and
 *   returns a `Result<SanitizedPath, PathSanitizerError>`. Rejection
 *   is the EXPECTED failure mode for invalid input, so callers branch
 *   on the kind exhaustively rather than try/catch.
 *
 * Contract:
 * - The scanner is stateless across calls. Implementations MAY cache
 *   the compiled regex set internally but MUST NOT carry per-workspace
 *   mutable state across calls (the `workspaceId` is supplied per call
 *   so different workspaces can run in parallel without coordinating).
 * - `scan` is `Promise`-typed to leave room for adapters that fetch
 *   patterns asynchronously (e.g. a registry that hot-reloads from
 *   `config.json`). Synchronous adapters wrap the result in
 *   `Promise.resolve` for free.
 * - `scanPath` is synchronous: path sanitisation is pure string
 *   manipulation and never blocks on I/O. Returning a `Result`
 *   (not a `Promise<Result>`) keeps the call cheap on the hot path.
 *
 * Errors:
 * - `scan` MUST NOT throw on detected secrets. A non-empty `findings`
 *   array is the expected success path. The application layer decides
 *   whether the findings warrant a hard reject (and emits
 *   `SecretBlocked` / `SecretDetected` accordingly).
 * - `scan` MAY throw `SecretDetectionFailedError` if the scanner
 *   itself misbehaves (registry inconsistent, entropy returned NaN,
 *   ...). That is an INTERNAL error, not a per-input rejection.
 */
export interface SecretsScanner {
  scan(text: string, workspaceId: WorkspaceId): Promise<SanitizedText>;
  scanPath(rawPath: string): Result<SanitizedPath, PathSanitizerError>;
}
