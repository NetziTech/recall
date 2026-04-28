import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `encryption`
 * bounded context.
 *
 * Mirrors the `WorkspaceDomainError` / `MemoryDomainError` pattern:
 * narrows `DomainError` so adapters can route every encryption-related
 * failure with a single `instanceof` test, and forces concrete
 * subclasses to declare their canonical JSON-RPC code (or `null` when
 * the protocol catalog does not allocate one).
 *
 * The encryption module's wire-level codes are documented in
 * `docs/02-protocolo-mcp.md` §6 and `docs/11-seguridad-modos.md` §8:
 *
 * - `-32107 ENCRYPTED_LOCKED` — workspace is encrypted, key not in
 *   HOME. Owned by the `workspace` module (`WorkspaceLockedError`),
 *   not here.
 * - `-32108 INVALID_KEY` — the candidate key does not decrypt the
 *   validator blob.
 * - `-32109 KEY_REVOKED` — the envelope used to derive the cached key
 *   was removed by `rekey`.
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited
 *   contract).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field as a
 *   `readonly` field initialiser. The mapping rule mirrors the
 *   sibling modules:
 *     - `number` (typically a value from `JsonRpcErrorCodes`) when
 *       the error has a defined wire-level code.
 *     - `null` when the domain abstains from claiming a code.
 *
 * Security note:
 * - Subclasses MUST NOT include key bytes, passphrase characters or
 *   derived material in their `message` or in any data field. Error
 *   messages cross trust boundaries (logs, transcripts, JSON-RPC
 *   responses) and are a classic side-channel for secret leakage.
 *   The redaction strategy of the secret VOs (`MasterKey`,
 *   `DerivedKey`, `Passphrase`) helps when those VOs are interpolated
 *   into a message, but the safest default is "do not interpolate at
 *   all". Cf. `docs/11-seguridad-modos.md` §3 ("Por que solo por
 *   stdout y no por canal MCP").
 */
export abstract class EncryptionDomainError extends DomainError {
  /**
   * Canonical JSON-RPC numeric code, or `null` when the domain
   * refuses to assign one. Concrete subclasses MUST override with a
   * `readonly` field initialiser.
   */
  public abstract readonly jsonRpcCode: number | null;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
