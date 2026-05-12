import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `retrieval`
 * bounded context.
 *
 * Mirrors the `MemoryDomainError` / `WorkspaceDomainError` pattern: it
 * narrows `DomainError` so adapters can route every retrieval failure
 * with a single `instanceof` test, and forces concrete subclasses to
 * declare their canonical JSON-RPC code (or `null` when the protocol
 * catalog does not allocate one).
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited from
 *   `DomainError`).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field. The
 *   mapping rule mirrors the rest of the codebase:
 *     - `number` (typically a value from `JsonRpcErrorCodes`) when the
 *       error has a defined wire-level code in
 *       `docs/02-protocolo-mcp.md` §6.
 *     - `null` when the domain abstains from claiming a code, leaving
 *       the adapter free to pick one (typically `INVALID_PARAMS`).
 *
 *   The field is `readonly` (never a method) so the transport layer can
 *   map errors uniformly with a single property read.
 */
export abstract class RetrievalDomainError extends DomainError {
  /**
   * Canonical JSON-RPC numeric code, or `null` when the domain refuses
   * to assign one. Concrete subclasses MUST override with a `readonly`
   * field initialiser.
   */
  public abstract readonly jsonRpcCode: number | null;

  protected constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
