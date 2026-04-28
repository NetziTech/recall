import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Relation } from "../aggregates/relation.ts";
import type { RelationEndpoint } from "../value-objects/relation-endpoint.ts";
import type { RelationId } from "../value-objects/relation-id.ts";

/**
 * Driven port for persisting and reloading the `Relation` aggregate.
 *
 * Mirrors the `relations` table contract from
 * `docs/03-modelo-datos.md` §4.6. Edges are looked up either by id
 * (audit) or by endpoint (graph traversal in capa 6 of the context
 * bundle, see `docs/04-capas-contexto.md` §3.6).
 *
 * Contract:
 * - `findById` returns `null` on miss.
 * - `save` is atomic. The persistence schema's `UNIQUE (from, to,
 *   kind)` constraint prevents duplicate inserts; adapters surface
 *   that as a domain error at the application boundary if it
 *   matters.
 */
export interface RelationRepository {
  findById(id: RelationId): Promise<Relation | null>;

  save(relation: Relation): Promise<void>;

  /**
   * Returns every edge whose `from` endpoint equals the supplied one.
   * Used by graph traversal that walks "outgoing" edges.
   */
  findFromEndpoint(endpoint: RelationEndpoint): Promise<readonly Relation[]>;

  /**
   * Returns every edge whose `to` endpoint equals the supplied one.
   * Used by graph traversal that walks "incoming" edges.
   */
  findToEndpoint(endpoint: RelationEndpoint): Promise<readonly Relation[]>;

  /**
   * Returns EVERY relation in `workspaceId`, ordered most-recent-first
   * (created_at_ms DESC, id DESC).
   *
   * Powers `MemorySnapshotReader` (export use case) AND
   * `AuditMemoryUseCase.collectRelationIssues` (which previously
   * walked entities one-by-one calling `findFromEndpoint` — that path
   * was N×M). The audit now loads relations once and validates the
   * dangling-endpoint condition in JS against a `Set<entityId>` for
   * O(1) lookup. Implementations MUST resolve the full set in a single
   * SQL query.
   *
   * Adapters that pin a `WorkspaceId` at construction time MUST
   * validate the argument matches.
   */
  findAllByWorkspace(workspaceId: WorkspaceId): Promise<readonly Relation[]>;
}
