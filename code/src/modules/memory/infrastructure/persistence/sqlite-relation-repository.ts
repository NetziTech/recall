import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Relation } from "../../domain/aggregates/relation.ts";
import type { RelationRepository } from "../../domain/repositories/relation-repository.ts";
import { EntityId } from "../../domain/value-objects/entity-id.ts";
import { RelationEndpoint } from "../../domain/value-objects/relation-endpoint.ts";
import { RelationId } from "../../domain/value-objects/relation-id.ts";
import { RelationKind } from "../../domain/value-objects/relation-kind.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const RelationRowSchema = z.object({
  id: z.string().min(1),
  from_entity_id: z.string().min(1),
  to_entity_id: z.string().min(1),
  relation: z.string().min(1),
  created_at_ms: z.number().int().min(0),
  confidence: z.number(),
});

const SQL_INSERT = `
INSERT INTO relations (
  id, from_entity_id, to_entity_id, relation, created_at_ms, confidence
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  from_entity_id = excluded.from_entity_id,
  to_entity_id   = excluded.to_entity_id,
  relation       = excluded.relation,
  confidence     = excluded.confidence
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, from_entity_id, to_entity_id, relation, created_at_ms, confidence
FROM relations
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_BY_FROM = `
SELECT id, from_entity_id, to_entity_id, relation, created_at_ms, confidence
FROM relations
WHERE from_entity_id = ?
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_TO = `
SELECT id, from_entity_id, to_entity_id, relation, created_at_ms, confidence
FROM relations
WHERE to_entity_id = ?
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_ALL = `
SELECT id, from_entity_id, to_entity_id, relation, created_at_ms, confidence
FROM relations
ORDER BY created_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `RelationRepository`.
 *
 * MVP scope: only entity-to-entity edges are persisted (the schema's
 * `from_entity_id` and `to_entity_id` are FKs to `entities.id`). The
 * domain widens beyond entities (`RelationEndpoint.decision/learning/...`),
 * but until the polymorphic-relations ADR lands the adapter rejects
 * non-entity endpoints at write time and skips them at the
 * `findFromEndpoint`/`findToEndpoint` paths (returning empty arrays).
 *
 * The rejection paths surface
 * `MemoryInfrastructureError.upsertFailed` so the caller (the
 * `RecordRelationUseCase`) can route on the error and roll up to a
 * domain-level message.
 */
export class SqliteRelationRepository implements RelationRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: RelationId): Promise<Relation | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("relations", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(relation: Relation): Promise<void> {
    const from = relation.getFrom().toValue();
    const to = relation.getTo().toValue();
    if (from.kind !== "entity" || to.kind !== "entity") {
      throw MemoryInfrastructureError.upsertFailed(
        "relations",
        new Error(
          `MVP only persists entity-to-entity edges (got from=${from.kind}, to=${to.kind})`,
        ),
      );
    }
    const stmt = this.db.prepare(SQL_INSERT);
    try {
      stmt.run(
        relation.getId().toString(),
        from.id.toString(),
        to.id.toString(),
        relation.getKind().toString(),
        relation.getCreatedAt().toEpochMs(),
        relation.getWeight().toNumber(),
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("relations", cause);
    }
    return Promise.resolve();
  }

  public async findFromEndpoint(
    endpoint: RelationEndpoint,
  ): Promise<readonly Relation[]> {
    if (endpoint.kind !== "entity") return Promise.resolve(Object.freeze([]));
    return this.runListQuery(SQL_SELECT_BY_FROM, [endpoint.idAsString()]);
  }

  public async findToEndpoint(
    endpoint: RelationEndpoint,
  ): Promise<readonly Relation[]> {
    if (endpoint.kind !== "entity") return Promise.resolve(Object.freeze([]));
    return this.runListQuery(SQL_SELECT_BY_TO, [endpoint.idAsString()]);
  }

  public async findAllByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Relation[]> {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "relations",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
    return this.runListQuery(SQL_SELECT_ALL, []);
  }

  // -- internals --------------------------------------------------------

  private async runListQuery(
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Relation[]> {
    const stmt = this.db.prepare(sql);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(...params);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("relations", cause);
    }
    const out: Relation[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  private parseRow(raw: unknown): Relation {
    let parsed: z.infer<typeof RelationRowSchema>;
    try {
      parsed = RelationRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "relations",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    return Relation.rehydrate({
      id: RelationId.from(parsed.id),
      workspaceId: this.workspaceId,
      from: RelationEndpoint.entity(EntityId.from(parsed.from_entity_id)),
      to: RelationEndpoint.entity(EntityId.from(parsed.to_entity_id)),
      kind: RelationKind.create(parsed.relation),
      weight: Confidence.of(parsed.confidence),
      createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
    });
  }
}
