import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `secrets`
 * bounded context.
 *
 * It only narrows `DomainError` to provide a single `instanceof` test for
 * adapters that want to map every secret-related failure (path traversal
 * refusals, regex compile failures, scanner crashes, etc.) to a coherent
 * transport response. Concrete subclasses still expose their own stable
 * `code` so the JSON-RPC layer can route the error precisely
 * (see `docs/02-protocolo-mcp.md` §6 and
 * `docs/11-seguridad-modos.md` §6 / §8).
 *
 * Invariants:
 * - Subclasses MUST set a stable, kebab-case `code` (inherited contract).
 * - Subclasses MUST set a `jsonRpcCode: number | null` field. The
 *   canonical mapping rule is:
 *     - `number` (typically a value from `JsonRpcErrorCodes`) when the
 *       error has a defined wire-level code in
 *       `docs/11-seguridad-modos.md` §8 / `docs/02-protocolo-mcp.md` §6.
 *       The detection-of-a-secret case maps to
 *       `JsonRpcErrorCodes.SECRET_DETECTED` (`-32105`).
 *     - `null` when the domain deliberately abstains from claiming a
 *       code, leaving the adapter free to choose (e.g. the standard
 *       `INVALID_PARAMS` -32602 for an invalid regex).
 *
 *   We use a `readonly` field on every concrete subclass — never a
 *   method — so `instanceof` checks plus a single property read suffice
 *   for the transport layer to map errors uniformly. This mirrors the
 *   pattern adopted by `WorkspaceDomainError` (see
 *   `modules/workspace/domain/errors/workspace-domain-error.ts`).
 */
export abstract class SecretsDomainError extends DomainError {
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
