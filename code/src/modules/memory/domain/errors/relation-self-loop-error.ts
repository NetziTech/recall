import type { RelationEndpoint } from "../value-objects/relation-endpoint.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when a `Relation` is built with `from` and `to` pointing at
 * the same memory entry.
 *
 * Self-loops are not meaningful in the memory graph: the recall layer
 * uses relations to expand a query into related memories, and a
 * self-loop would either be a no-op (already in the result set) or
 * worse, an infinite expansion. The schema in
 * `docs/03-modelo-datos.md` §4.6 also enforces uniqueness via
 * `UNIQUE (from_entity_id, to_entity_id, relation)` — modelling
 * self-loops would still let degenerate `(A, A, related_to)` rows
 * exist. The aggregate rejects them up front.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.relation-self-loop`.
 * - `endpoint` carries the offending endpoint so adapters can echo it.
 * - `jsonRpcCode` is `null`.
 */
export class RelationSelfLoopError extends MemoryDomainError {
  public readonly code = "memory.relation-self-loop";
  public readonly jsonRpcCode: number | null = null;
  public readonly endpoint: RelationEndpoint;

  public constructor(endpoint: RelationEndpoint, options?: { cause?: unknown }) {
    super(
      `relation cannot connect ${endpoint.kind} ${endpoint.idAsString()} to itself`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.endpoint = endpoint;
  }
}
