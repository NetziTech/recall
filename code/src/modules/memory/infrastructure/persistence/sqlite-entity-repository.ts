import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Entity } from "../../domain/aggregates/entity.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { EntityDescription } from "../../domain/value-objects/entity-description.ts";
import { EntityId } from "../../domain/value-objects/entity-id.ts";
import { EntityKind } from "../../domain/value-objects/entity-kind.ts";
import { EntityName } from "../../domain/value-objects/entity-name.ts";
import { LastUsed } from "../../domain/value-objects/last-used.ts";
import { Scope } from "../../domain/value-objects/scope.ts";
import { UseCount } from "../../domain/value-objects/use-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const EntityRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entity_kind: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
  created_at_ms: z.number().int().min(0),
  updated_at_ms: z.number().int().min(0),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  tags_json: z.string(),
});

const TagsArraySchema = z.array(z.string().min(1));

const SQL_UPSERT = `
INSERT INTO entities (
  id, name, entity_kind, description, location, created_at_ms, updated_at_ms,
  confidence, last_used_ms, use_count, tags_json
) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name           = excluded.name,
  entity_kind    = excluded.entity_kind,
  description    = excluded.description,
  updated_at_ms  = excluded.updated_at_ms,
  confidence     = excluded.confidence,
  last_used_ms   = excluded.last_used_ms,
  use_count      = excluded.use_count,
  tags_json      = excluded.tags_json
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, name, entity_kind, description, location, created_at_ms,
       updated_at_ms, confidence, last_used_ms, use_count, tags_json
FROM entities
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_BY_NAME_AND_KIND = `
SELECT id, name, entity_kind, description, location, created_at_ms,
       updated_at_ms, confidence, last_used_ms, use_count, tags_json
FROM entities
WHERE name = ? AND entity_kind = ?
LIMIT 1
`.trim();

const SQL_SELECT_ALL = `
SELECT id, name, entity_kind, description, location, created_at_ms,
       updated_at_ms, confidence, last_used_ms, use_count, tags_json
FROM entities
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_KIND = `
SELECT id, name, entity_kind, description, location, created_at_ms,
       updated_at_ms, confidence, last_used_ms, use_count, tags_json
FROM entities
WHERE entity_kind = ?
ORDER BY created_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `EntityRepository`.
 *
 * The persistence layer materialises the domain's `EntityDescription`
 * discriminated union as the empty string when `kind === "unknown"`
 * (matching the reader convention in
 * `retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts`).
 *
 * Workspace scoping pinned at construction (per
 * `docs/03-modelo-datos.md` §4.1).
 */
export class SqliteEntityRepository implements EntityRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: EntityId): Promise<Entity | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("entities", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(entity: Entity): Promise<void> {
    const description = entity.getDescription().toStringOrNull() ?? "";
    const tagsJson = JSON.stringify(entity.getTags().toArray());
    const lastUsedMs = SqliteEntityRepository.lastUsedToMs(
      entity.getLastUsed(),
      entity.getCreatedAt(),
    );

    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        entity.getId().toString(),
        entity.getName().toString(),
        entity.getKind().toString(),
        description,
        entity.getCreatedAt().toEpochMs(),
        entity.getUpdatedAt().toEpochMs(),
        entity.getConfidence().toNumber(),
        lastUsedMs,
        entity.getUseCount().value,
        tagsJson,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("entities", cause);
    }
    return Promise.resolve();
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
    kind?: EntityKind,
  ): Promise<readonly Entity[]> {
    this.assertWorkspace(workspaceId);
    if (kind === undefined) {
      return this.runListQuery(SQL_SELECT_ALL, []);
    }
    return this.runListQuery(SQL_SELECT_BY_KIND, [kind.toString()]);
  }

  public async findByNameAndKind(
    workspaceId: WorkspaceId,
    name: EntityName,
    kind: EntityKind,
  ): Promise<Entity | null> {
    this.assertWorkspace(workspaceId);
    const stmt = this.db.prepare(SQL_SELECT_BY_NAME_AND_KIND);
    let row: unknown;
    try {
      row = stmt.get(name.toString(), kind.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("entities", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  // -- internals --------------------------------------------------------

  private assertWorkspace(workspaceId: WorkspaceId): void {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "entities",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
  }

  private async runListQuery(
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Entity[]> {
    const stmt = this.db.prepare(sql);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(...params);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("entities", cause);
    }
    const out: Entity[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  private parseRow(raw: unknown): Entity {
    let parsed: z.infer<typeof EntityRowSchema>;
    try {
      parsed = EntityRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "entities",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const tags = SqliteEntityRepository.parseTags(parsed.tags_json);
    const description =
      parsed.description.length === 0
        ? EntityDescription.unknown()
        : EntityDescription.of(parsed.description);
    const createdAt = Timestamp.fromEpochMs(parsed.created_at_ms);
    const updatedAt = Timestamp.fromEpochMs(parsed.updated_at_ms);
    return Entity.rehydrate({
      id: EntityId.from(parsed.id),
      workspaceId: this.workspaceId,
      name: EntityName.from(parsed.name),
      kind: EntityKind.create(parsed.entity_kind),
      description,
      tags,
      confidence: Confidence.of(parsed.confidence),
      useCount: UseCount.of(parsed.use_count),
      lastUsed: LastUsed.at(Timestamp.fromEpochMs(parsed.last_used_ms)),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      createdAt,
      updatedAt,
    });
  }

  private static parseTags(rawJson: string): Tags {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = TagsArraySchema.parse(decoded);
      if (validated.length === 0) return Tags.empty();
      return Tags.create(validated);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "entities",
        `tags_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  private static lastUsedToMs(
    lastUsed: LastUsed,
    createdAt: Timestamp,
  ): number {
    if (lastUsed.kind === "at" && lastUsed.at !== null) {
      return lastUsed.at.toEpochMs();
    }
    return createdAt.toEpochMs();
  }
}
