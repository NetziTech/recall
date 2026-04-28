import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Decision } from "../../domain/aggregates/decision.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { DecisionStatus } from "../../domain/value-objects/decision-status.ts";
import { DecisionTitle } from "../../domain/value-objects/decision-title.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { LastUsed } from "../../domain/value-objects/last-used.ts";
import { Rationale } from "../../domain/value-objects/rationale.ts";
import { Scope } from "../../domain/value-objects/scope.ts";
import { SupersededBy } from "../../domain/value-objects/superseded-by.ts";
import { UseCount } from "../../domain/value-objects/use-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

/**
 * Zod schema for the persisted shape of a `decisions` row. Mirrors
 * `code/migrations/004__core-memory-schema.sql` §3. Per
 * `docs/03-modelo-datos.md` §4.1 the schema does NOT carry a
 * `workspace_id` column ("toda la DB ES el workspace"); the adapter
 * pins the workspace id at construction time and threads it through
 * the aggregate factories.
 */
const DecisionRowSchema = z.object({
  id: z.string().min(1),
  created_at_ms: z.number().int().min(0),
  title: z.string().min(1),
  rationale: z.string(),
  scope: z.string().min(1),
  module: z.string().nullable(),
  superseded_by: z.string().nullable(),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  tags_json: z.string(),
});

const TagsArraySchema = z.array(z.string().min(1));

const SQL_UPSERT = `
INSERT INTO decisions (
  id, created_at_ms, title, rationale, alternatives_rejected,
  scope, module, superseded_by, confidence, last_used_ms, use_count, tags_json
) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title          = excluded.title,
  rationale      = excluded.rationale,
  scope          = excluded.scope,
  module         = excluded.module,
  superseded_by  = excluded.superseded_by,
  confidence     = excluded.confidence,
  last_used_ms   = excluded.last_used_ms,
  use_count      = excluded.use_count,
  tags_json      = excluded.tags_json
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, created_at_ms, title, rationale, scope, module,
       superseded_by, confidence, last_used_ms, use_count, tags_json
FROM decisions
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_ALL = `
SELECT id, created_at_ms, title, rationale, scope, module,
       superseded_by, confidence, last_used_ms, use_count, tags_json
FROM decisions
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_STATUS_ACTIVE = `
SELECT id, created_at_ms, title, rationale, scope, module,
       superseded_by, confidence, last_used_ms, use_count, tags_json
FROM decisions
WHERE superseded_by IS NULL
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_STATUS_SUPERSEDED = `
SELECT id, created_at_ms, title, rationale, scope, module,
       superseded_by, confidence, last_used_ms, use_count, tags_json
FROM decisions
WHERE superseded_by IS NOT NULL
ORDER BY created_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `DecisionRepository`.
 *
 * Schema: `code/migrations/004__core-memory-schema.sql` §3. The FTS5
 * shadow (`decisions_fts`) is maintained automatically by the SQL
 * triggers in the migration; the adapter never writes to the shadow
 * directly.
 *
 * Workspace scoping:
 * - Per `docs/03-modelo-datos.md` §4.1, "toda la DB ES el workspace":
 *   the persisted tables have no `workspace_id` column. The adapter
 *   accepts the workspace id at construction time and threads it
 *   through the aggregate factories so the in-memory representation
 *   carries the right id.
 * - The `findByWorkspace(...)` argument is validated against the
 *   construction-time id; a mismatch throws
 *   `MemoryInfrastructureError.queryFailed` to surface the
 *   composition-root wiring bug at the boundary.
 *
 * Concurrency:
 * - Every method uses prepared statements; SQL bindings are the only
 *   path for user data.
 * - `save(...)` is upsert by id (idempotent re-save).
 * - `last_used_ms` is non-nullable in the schema; the adapter
 *   materialises `LastUsed.never()` as `created_at_ms` on the SQL
 *   boundary (mirrors the curator's reader).
 */
export class SqliteDecisionRepository implements DecisionRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: DecisionId): Promise<Decision | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("decisions", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(decision: Decision): Promise<void> {
    const lastUsedMs = SqliteDecisionRepository.lastUsedToMs(
      decision.getLastUsed(),
      decision.getCreatedAt(),
    );
    const moduleValue = SqliteDecisionRepository.moduleValueOf(
      decision.getScope(),
    );
    const supersededByValue =
      decision.getSupersededBy()?.decisionId.toString() ?? null;
    const tagsJson = JSON.stringify(decision.getTags().toArray());

    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        decision.getId().toString(),
        decision.getCreatedAt().toEpochMs(),
        decision.getTitle().toString(),
        decision.getRationale().toString(),
        decision.getScope().kind,
        moduleValue,
        supersededByValue,
        decision.getConfidence().toNumber(),
        lastUsedMs,
        decision.getUseCount().value,
        tagsJson,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("decisions", cause);
    }
    return Promise.resolve();
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
    status?: DecisionStatus,
  ): Promise<readonly Decision[]> {
    this.assertWorkspace(workspaceId);
    const sql =
      status === undefined
        ? SQL_SELECT_ALL
        : status.isActive()
          ? SQL_SELECT_BY_STATUS_ACTIVE
          : SQL_SELECT_BY_STATUS_SUPERSEDED;
    return this.runListQuery(sql, []);
  }

  public async findActiveByTags(
    workspaceId: WorkspaceId,
    requiredTags: Tags,
  ): Promise<readonly Decision[]> {
    this.assertWorkspace(workspaceId);
    // The schema does not expose a JSON-aware tag index; we filter in
    // memory after the SARGable `superseded_by IS NULL` predicate. The
    // active set is bounded (decisions are never deleted but the
    // active subset is what `recall` queries), so a sequential scan
    // with in-memory tag matching is acceptable for the MVP. A future
    // optimisation could lift the tags into a join table; tracked as
    // a Fase 5 perf note.
    const all = await this.runListQuery(SQL_SELECT_BY_STATUS_ACTIVE, []);
    if (requiredTags.isEmpty()) return all;
    const filtered: Decision[] = [];
    for (const d of all) {
      if (d.getTags().includesAll(requiredTags)) filtered.push(d);
    }
    return Object.freeze(filtered);
  }

  // -- internals --------------------------------------------------------

  private assertWorkspace(workspaceId: WorkspaceId): void {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "decisions",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
  }

  private async runListQuery(
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Decision[]> {
    const stmt = this.db.prepare(sql);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(...params);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("decisions", cause);
    }
    const out: Decision[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  private parseRow(raw: unknown): Decision {
    let parsed: z.infer<typeof DecisionRowSchema>;
    try {
      parsed = DecisionRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "decisions",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const tags = SqliteDecisionRepository.parseTags(parsed.tags_json);
    const status =
      parsed.superseded_by === null
        ? DecisionStatus.active()
        : DecisionStatus.superseded();
    const supersededBy =
      parsed.superseded_by === null
        ? null
        : SupersededBy.fromRaw(parsed.superseded_by);
    const scope =
      parsed.module === null
        ? Scope.project()
        : Scope.create(parsed.scope, parsed.module);
    const createdAt = Timestamp.fromEpochMs(parsed.created_at_ms);
    const lastUsed = LastUsed.at(Timestamp.fromEpochMs(parsed.last_used_ms));
    return Decision.rehydrate({
      id: DecisionId.from(parsed.id),
      workspaceId: this.workspaceId,
      sessionId: null,
      title: DecisionTitle.from(parsed.title),
      rationale: Rationale.from(parsed.rationale),
      tags,
      status,
      supersededBy,
      confidence: Confidence.of(parsed.confidence),
      useCount: UseCount.of(parsed.use_count),
      lastUsed,
      scope,
      embeddingStatus: EmbeddingStatus.pending(),
      createdAt,
      updatedAt: createdAt,
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
        "decisions",
        `tags_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  private static lastUsedToMs(lastUsed: LastUsed, createdAt: Timestamp): number {
    if (lastUsed.kind === "at" && lastUsed.at !== null) {
      return lastUsed.at.toEpochMs();
    }
    // `never`: the schema column is NOT NULL; mirror the convention
    // of pinning to `created_at_ms` (Tarea 3.3 reader uses the same
    // mapping in reverse).
    return createdAt.toEpochMs();
  }

  private static moduleValueOf(scope: Scope): string | null {
    if (scope.isModule()) return scope.module;
    return null;
  }
}
