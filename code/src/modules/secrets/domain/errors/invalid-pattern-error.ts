import { SecretsDomainError } from "./secrets-domain-error.ts";

/**
 * Raised when `SecretPattern.create(...)` (or any other factory that
 * compiles a regex) refuses the input.
 *
 * Two failure modes are folded into this single class because they both
 * reflect "the pattern as supplied cannot be turned into a usable
 * detector":
 * - The regex source is syntactically invalid (`new RegExp(...)` throws
 *   a `SyntaxError`).
 * - The regex has structural properties that would be unsafe in the
 *   secret-scanner context (e.g. it lacks the global flag the matcher
 *   relies on; the factory typically sets the flag itself, so this case
 *   is reserved for explicit user-provided regexes).
 *
 * The pattern source string is intentionally NOT carried on the error
 * (kept off the message and off public fields) because user-supplied
 * patterns may themselves contain partial secret material the operator
 * was about to register — echoing it back into logs would defeat the
 * purpose of the secrets bounded context.
 *
 * Invariants:
 * - `code` is the stable identifier `secrets.invalid-pattern`.
 * - `patternName` (when provided) names the offending pattern so
 *   adapters can correlate the error with its registry entry without
 *   leaking the regex source.
 * - `jsonRpcCode` is `null`: pattern compilation is a configuration-
 *   time concern, not a per-request protocol error. Adapters typically
 *   map this to the standard JSON-RPC `INVALID_PARAMS` (-32602).
 */
export class InvalidPatternError extends SecretsDomainError {
  public readonly code = "secrets.invalid-pattern";
  public readonly jsonRpcCode: number | null = null;
  public readonly patternName: string | null;

  public constructor(
    message: string,
    options?: { patternName?: string; cause?: unknown },
  ) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.patternName = options?.patternName ?? null;
  }
}
