import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Learning } from "../../domain/aggregates/learning.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { LastUsed } from "../../domain/value-objects/last-used.ts";
import { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../domain/value-objects/learning-severity.ts";
import { LearningText } from "../../domain/value-objects/learning-text.ts";
import { Scope } from "../../domain/value-objects/scope.ts";
import { UseCount } from "../../domain/value-objects/use-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const LearningRowSchema = z.object({
  id: z.string().min(1),
  created_at_ms: z.number().int().min(0),
  content: z.string().min(1),
  trigger: z.string().nullable(),
  scope: z.string().min(1),
  module: z.string().nullable(),
  severity: z.string().min(1),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  tags_json: z.string(),
  consolidated_into: z.string().nullable(),
});

const TagsArraySchema = z.array(z.string().min(1));

const SQL_UPSERT = `
INSERT INTO learnings (
  id, created_at_ms, content, trigger, scope, module, severity,
  confidence, last_used_ms, use_count, tags_json, consolidated_into
) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  content            = excluded.content,
  scope              = excluded.scope,
  module             = excluded.module,
  severity           = excluded.severity,
  confidence         = excluded.confidence,
  last_used_ms       = excluded.last_used_ms,
  use_count          = excluded.use_count,
  tags_json          = excluded.tags_json,
  consolidated_into  = excluded.consolidated_into
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, created_at_ms, content, trigger, scope, module, severity,
       confidence, last_used_ms, use_count, tags_json, consolidated_into
FROM learnings
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_ALL = `
SELECT id, created_at_ms, content, trigger, scope, module, severity,
       confidence, last_used_ms, use_count, tags_json, consolidated_into
FROM learnings
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_ACTIVE_BY_SEVERITY = `
SELECT id, created_at_ms, content, trigger, scope, module, severity,
       confidence, last_used_ms, use_count, tags_json, consolidated_into
FROM learnings
WHERE consolidated_into IS NULL
ORDER BY created_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `LearningRepository`.
 *
 * Closes the `PendingLearningRepository` stub the composition root
 * shipped with as a placeholder during Fase 4.
 *
 * Workspace scoping mirrors `SqliteDecisionRepository`: pinned at
 * construction (per `docs/03-modelo-datos.md` §4.1, the DB IS the
 * workspace).
 */
export class SqliteLearningRepository implements LearningRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: LearningId): Promise<Learning | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("learnings", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(learning: Learning): Promise<void> {
    const lastUsedMs = SqliteLearningRepository.lastUsedToMs(
      learning.getLastUsed(),
      learning.getCreatedAt(),
    );
    const moduleValue = SqliteLearningRepository.moduleValueOf(
      learning.getScope(),
    );
    const consolidated = learning.getConsolidatedInto()?.toString() ?? null;
    const tagsJson = JSON.stringify(learning.getTags().toArray());

    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        learning.getId().toString(),
        learning.getCreatedAt().toEpochMs(),
        learning.getText().toString(),
        learning.getScope().kind,
        moduleValue,
        learning.getSeverity().toString(),
        learning.getConfidence().toNumber(),
        lastUsedMs,
        learning.getUseCount().value,
        tagsJson,
        consolidated,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("learnings", cause);
    }
    return Promise.resolve();
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Learning[]> {
    this.assertWorkspace(workspaceId);
    return this.runListQuery(SQL_SELECT_ALL, []);
  }

  public async findActiveByMinimumSeverity(
    workspaceId: WorkspaceId,
    minimumSeverity: LearningSeverity,
  ): Promise<readonly Learning[]> {
    this.assertWorkspace(workspaceId);
    const all = await this.runListQuery(SQL_SELECT_ACTIVE_BY_SEVERITY, []);
    const filtered: Learning[] = [];
    for (const l of all) {
      if (l.getSeverity().isAtLeast(minimumSeverity)) filtered.push(l);
    }
    return Object.freeze(filtered);
  }

  // -- internals --------------------------------------------------------

  private assertWorkspace(workspaceId: WorkspaceId): void {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "learnings",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
  }

  private async runListQuery(
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Learning[]> {
    const stmt = this.db.prepare(sql);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(...params);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("learnings", cause);
    }
    const out: Learning[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  private parseRow(raw: unknown): Learning {
    let parsed: z.infer<typeof LearningRowSchema>;
    try {
      parsed = LearningRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "learnings",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const tags = SqliteLearningRepository.parseTags(parsed.tags_json);
    const scope =
      parsed.module === null
        ? Scope.project()
        : Scope.create(parsed.scope, parsed.module);
    const consolidated =
      parsed.consolidated_into === null
        ? null
        : LearningId.from(parsed.consolidated_into);
    const createdAt = Timestamp.fromEpochMs(parsed.created_at_ms);
    return Learning.rehydrate({
      id: LearningId.from(parsed.id),
      workspaceId: this.workspaceId,
      text: LearningText.from(parsed.content),
      severity: LearningSeverity.create(parsed.severity),
      tags,
      confidence: Confidence.of(parsed.confidence),
      useCount: UseCount.of(parsed.use_count),
      lastUsed: LastUsed.at(Timestamp.fromEpochMs(parsed.last_used_ms)),
      scope,
      embeddingStatus: EmbeddingStatus.pending(),
      consolidatedInto: consolidated,
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
        "learnings",
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

  private static moduleValueOf(scope: Scope): string | null {
    if (scope.isModule()) return scope.module;
    return null;
  }
}
