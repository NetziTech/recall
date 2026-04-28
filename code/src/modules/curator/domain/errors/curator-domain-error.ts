import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `curator`
 * bounded context.
 *
 * Mirrors the `MemoryDomainError` pattern: narrows `DomainError` so
 * adapters can route every curator-related failure with a single
 * `instanceof` test, and forces concrete subclasses to declare their
 * canonical JSON-RPC code (or `null` when the protocol catalog does
 * not allocate one).
 *
 * The curator runs in the background and most of its failures are
 * internal (an aggregate is in the wrong lifecycle state, a defaulting
 * factor is out of range). None of the standard JSON-RPC slots in
 * `docs/02-protocolo-mcp.md` §6 currently target curator-only failures
 * — `RATE_LIMITED` (-32106) is the closest fit when the curator is
 * already running. Subclasses therefore default to `null` unless a
 * concrete code applies (e.g. `RATE_LIMITED` for a "run already
 * started" guard exposed through `mem.curator_run`).
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited
 *   contract).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field as a
 *   `readonly` field initialiser (never a method) so the transport
 *   layer can map errors uniformly with a single property read.
 */
export abstract class CuratorDomainError extends DomainError {
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
