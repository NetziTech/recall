import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `memory`
 * bounded context.
 *
 * Mirrors the `WorkspaceDomainError` pattern from the workspace module:
 * narrows `DomainError` so adapters can route every memory-related
 * failure with a single `instanceof` test, and forces concrete
 * subclasses to declare their canonical JSON-RPC code (or `null` when
 * the protocol catalog does not allocate one).
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited
 *   contract).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field. The
 *   mapping rule mirrors `WorkspaceDomainError`:
 *     - `number` (typically a value from `JsonRpcErrorCodes`) when the
 *       error has a defined wire-level code in
 *       `docs/02-protocolo-mcp.md` §6.
 *     - `null` when the domain abstains from claiming a code, leaving
 *       the adapter free to pick one (typically `INVALID_PARAMS`).
 *
 *   The field is `readonly` (never a method) so the transport layer
 *   can map errors uniformly with a single property read.
 */
export abstract class MemoryDomainError extends DomainError {
  /**
   * Canonical JSON-RPC numeric code, or `null` when the domain refuses
   * to assign one. Concrete subclasses MUST override with a `readonly`
   * field initialiser.
   */
  public abstract readonly jsonRpcCode: number | null;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
