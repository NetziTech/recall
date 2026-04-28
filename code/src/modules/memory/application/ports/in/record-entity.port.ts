import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { EntityId } from "../../../domain/value-objects/entity-id.ts";
import type { EntityKind } from "../../../domain/value-objects/entity-kind.ts";
import type { Scope } from "../../../domain/value-objects/scope.ts";

/**
 * Result of a `RecordEntity` invocation.
 */
export interface RecordEntityResult {
  readonly entityId: EntityId;
  readonly embeddingEnqueued: boolean;
  /**
   * `true` when an entity with the same `(name, kind)` pair already
   * existed and the use case returned the existing id without
   * inserting a new row. The aggregate's `register(...)` factory
   * rejects collisions; this flag exists so the caller can render
   * "already known" feedback to the user.
   */
  readonly alreadyExisted: boolean;
}

/**
 * Driving (input) port: register a new software-domain `Entity`
 * (struct, service, teammate, concept, ...).
 *
 * Maps to the `kind=entity` arm of `mem.remember`
 * (`docs/02-protocolo-mcp.md` §4.4). The use case:
 *
 * 1. Looks up `(workspaceId, name, kind)` via
 *    `EntityRepository.findByNameAndKind(...)`.
 * 2. If a match exists, returns the existing id with
 *    `alreadyExisted: true` (no write, no event).
 * 3. Otherwise mints a fresh `EntityId`, builds the aggregate,
 *    persists it, publishes events, and enqueues the embedding job.
 *
 * Why look up before insert (instead of relying on the SQL
 * `UNIQUE (name, entity_kind)` constraint to throw):
 * - The application contract is "soft idempotency": the second call
 *   with the same name+kind returns the original id rather than
 *   surfacing a database constraint violation. This matches the
 *   `mem.remember` behaviour expected by the CLI tests.
 * - The two-step lookup-then-insert is NOT race-safe in the strict
 *   sense (two concurrent CLI invocations could both miss the lookup
 *   and then race the insert); a defence-in-depth check on the
 *   constraint failure path is wired in by the use case.
 */
export interface RecordEntity {
  record(input: {
    workspaceId: WorkspaceId;
    name: string;
    kind: EntityKind;
    description: string | null;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordEntityResult>;
}
