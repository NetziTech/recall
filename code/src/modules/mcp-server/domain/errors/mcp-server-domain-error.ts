import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `mcp-server`
 * bounded context.
 *
 * Mirrors the `WorkspaceDomainError` and `MemoryDomainError` patterns:
 * narrows `DomainError` so adapters can route every mcp-server-related
 * failure with a single `instanceof` test, and forces concrete
 * subclasses to declare their canonical JSON-RPC code (or `null` when
 * the protocol catalog does not allocate one — adapters typically
 * default to `INVALID_PARAMS` -32602 in that case).
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited
 *   contract from `DomainError`).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field. The
 *   field is `readonly` (never a method) so the transport layer can
 *   map errors uniformly with a single property read.
 *     - `number` (typically a value from `JsonRpcErrorCodes` or one of
 *       the JSON-RPC 2.0 pre-defined codes) when the error has a
 *       defined wire-level code.
 *     - `null` when the domain abstains from claiming a code, leaving
 *       the adapter free to pick one.
 */
export abstract class McpServerDomainError extends DomainError {
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
