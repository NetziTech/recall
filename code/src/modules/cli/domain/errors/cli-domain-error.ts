import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Abstract base class for every error raised inside the `cli` bounded
 * context.
 *
 * The CLI module is a *very thin* domain — most of its behaviour lives in
 * `application/` (argv parsing, interactive prompts) and `infrastructure/`
 * (commander adapter, terminal IO). The handful of domain errors that DO
 * exist (unknown command, malformed args, out-of-range exit code) all
 * share two properties:
 *
 *   1. They surface only inside `recall <command>` invocations from a
 *      human terminal, never inside an MCP JSON-RPC request handler.
 *   2. They are translated by the infrastructure layer into a process
 *      exit (`process.exit(code)`) plus a Spanish-language message on
 *      `stderr`, NOT into a JSON-RPC error envelope.
 *
 * Consequently `jsonRpcCode` is *contractually* `null` for every concrete
 * subclass: there is no MCP transport to map onto. We still inherit the
 * `jsonRpcCode: number | null` field (the same shape used by the
 * `workspace` module's `WorkspaceDomainError`) so that any cross-cutting
 * adapter that surveys domain errors uniformly (audit log, telemetry)
 * does not need a special case for CLI errors. The price is the
 * appearance of a redundant field; the gain is a single contract for
 * "every domain error declares its JSON-RPC affinity, even if it is
 * `null`".
 *
 * Invariants:
 * - Concrete subclasses MUST set a stable, kebab-case `code` (inherited
 *   from `DomainError`).
 * - Concrete subclasses MUST set `jsonRpcCode` to `null`. The expected
 *   value is enforced by code review and tests rather than the type
 *   system because there is no narrower type than `null` we can pin
 *   without breaking the cross-module contract.
 */
export abstract class CliDomainError extends DomainError {
  /**
   * Always `null` for CLI errors; see the class docstring for the
   * rationale. Concrete subclasses override with a `readonly` field
   * initialiser whose value is `null`.
   */
  public abstract readonly jsonRpcCode: number | null;

  protected constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
