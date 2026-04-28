import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Turn } from "../../domain/aggregates/turn.ts";
import type { TurnRepository } from "../../domain/repositories/turn-repository.ts";
import { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { FilesTouched } from "../../domain/value-objects/files-touched.ts";
import { LastUsed } from "../../domain/value-objects/last-used.ts";
import { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LinkedDecisionIds } from "../../domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../domain/value-objects/linked-learning-ids.ts";
import { SessionId } from "../../domain/value-objects/session-id.ts";
import { TurnId } from "../../domain/value-objects/turn-id.ts";
import { TurnIntent } from "../../domain/value-objects/turn-intent.ts";
import { TurnOutcome } from "../../domain/value-objects/turn-outcome.ts";
import { TurnSummary } from "../../domain/value-objects/turn-summary.ts";
import { UseCount } from "../../domain/value-objects/use-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const TurnRowSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().min(1),
  recorded_at_ms: z.number().int().min(0),
  summary: z.string().min(1),
  intent: z.string().nullable(),
  outcome: z.string().nullable(),
  files_touched_json: z.string(),
  decisions_json: z.string(),
  learnings_json: z.string(),
  tags_json: z.string(),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
});

const StringArraySchema = z.array(z.string().min(1));

const SQL_INSERT = `
INSERT INTO turns (
  id, session_id, recorded_at_ms, summary, intent, outcome,
  files_touched_json, decisions_json, learnings_json, tags_json,
  confidence, last_used_ms, use_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  summary       = excluded.summary,
  intent        = excluded.intent,
  outcome       = excluded.outcome,
  confidence    = excluded.confidence,
  last_used_ms  = excluded.last_used_ms,
  use_count     = excluded.use_count
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, session_id, recorded_at_ms, summary, intent, outcome,
       files_touched_json, decisions_json, learnings_json, tags_json,
       confidence, last_used_ms, use_count
FROM turns
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_BY_SESSION_RECENT = `
SELECT id, session_id, recorded_at_ms, summary, intent, outcome,
       files_touched_json, decisions_json, learnings_json, tags_json,
       confidence, last_used_ms, use_count
FROM turns
WHERE session_id = ?
ORDER BY recorded_at_ms DESC, id DESC
LIMIT ?
`.trim();

const SQL_SELECT_ALL = `
SELECT id, session_id, recorded_at_ms, summary, intent, outcome,
       files_touched_json, decisions_json, learnings_json, tags_json,
       confidence, last_used_ms, use_count
FROM turns
ORDER BY recorded_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `TurnRepository`.
 *
 * Turns are append-only history; the adapter still uses an
 * `INSERT ... ON CONFLICT ... UPDATE` for the recall-bookkeeping
 * counters (`confidence`, `last_used_ms`, `use_count`) the curator and
 * recall layer mutate. The body fields (`summary`, `intent`,
 * `outcome`) are immutable post-creation per the aggregate's contract,
 * so the upsert path's `excluded.summary` clause is defensive.
 */
export class SqliteTurnRepository implements TurnRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: TurnId): Promise<Turn | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("turns", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(turn: Turn): Promise<void> {
    const filesJson = JSON.stringify(turn.getFilesTouched().toArray());
    const decisionsJson = JSON.stringify(
      turn
        .getLinkedDecisions()
        .toArray()
        .map((d) => d.toString()),
    );
    const learningsJson = JSON.stringify(
      turn
        .getLinkedLearnings()
        .toArray()
        .map((l) => l.toString()),
    );
    const tagsJson = JSON.stringify(turn.getTags().toArray());
    const lastUsedMs = SqliteTurnRepository.lastUsedToMs(
      turn.getLastUsed(),
      turn.getCreatedAt(),
    );

    const stmt = this.db.prepare(SQL_INSERT);
    try {
      stmt.run(
        turn.getId().toString(),
        turn.getSessionId().toString(),
        turn.getCreatedAt().toEpochMs(),
        turn.getSummary().toString(),
        turn.getIntent()?.toString() ?? null,
        turn.getOutcome()?.toString() ?? null,
        filesJson,
        decisionsJson,
        learningsJson,
        tagsJson,
        turn.getConfidence().toNumber(),
        lastUsedMs,
        turn.getUseCount().value,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("turns", cause);
    }
    return Promise.resolve();
  }

  public async findBySession(
    sessionId: SessionId,
    limit: number,
  ): Promise<readonly Turn[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw MemoryInfrastructureError.queryFailed(
        "turns",
        new Error(`limit must be a positive integer (got: ${String(limit)})`),
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_BY_SESSION_RECENT);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(sessionId.toString(), limit);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("turns", cause);
    }
    const out: Turn[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  public async findAllByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Turn[]> {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "turns",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_ALL);
    let rows: readonly unknown[];
    try {
      rows = stmt.all();
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("turns", cause);
    }
    const out: Turn[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): Turn {
    let parsed: z.infer<typeof TurnRowSchema>;
    try {
      parsed = TurnRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "turns",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const filesTouched = SqliteTurnRepository.parseFiles(
      parsed.files_touched_json,
    );
    const linkedDecisions = SqliteTurnRepository.parseLinkedDecisions(
      parsed.decisions_json,
    );
    const linkedLearnings = SqliteTurnRepository.parseLinkedLearnings(
      parsed.learnings_json,
    );
    const tags = SqliteTurnRepository.parseTags(parsed.tags_json);
    const createdAt = Timestamp.fromEpochMs(parsed.recorded_at_ms);
    return Turn.rehydrate({
      id: TurnId.from(parsed.id),
      workspaceId: this.workspaceId,
      sessionId: SessionId.from(parsed.session_id),
      summary: TurnSummary.from(parsed.summary),
      intent: parsed.intent === null ? null : TurnIntent.from(parsed.intent),
      outcome:
        parsed.outcome === null ? null : TurnOutcome.from(parsed.outcome),
      filesTouched,
      linkedDecisions,
      linkedLearnings,
      tags,
      confidence: Confidence.of(parsed.confidence),
      useCount: UseCount.of(parsed.use_count),
      lastUsed: LastUsed.at(Timestamp.fromEpochMs(parsed.last_used_ms)),
      createdAt,
    });
  }

  private static parseFiles(rawJson: string): FilesTouched {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = StringArraySchema.parse(decoded);
      if (validated.length === 0) return FilesTouched.empty();
      return FilesTouched.create(validated);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "turns",
        `files_touched_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  private static parseLinkedDecisions(rawJson: string): LinkedDecisionIds {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = StringArraySchema.parse(decoded);
      if (validated.length === 0) return LinkedDecisionIds.empty();
      const ids = validated.map((s) => DecisionId.from(s));
      return LinkedDecisionIds.create(ids);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "turns",
        `decisions_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  private static parseLinkedLearnings(rawJson: string): LinkedLearningIds {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = StringArraySchema.parse(decoded);
      if (validated.length === 0) return LinkedLearningIds.empty();
      const ids = validated.map((s) => LearningId.from(s));
      return LinkedLearningIds.create(ids);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "turns",
        `learnings_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  private static parseTags(rawJson: string): Tags {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = StringArraySchema.parse(decoded);
      if (validated.length === 0) return Tags.empty();
      return Tags.create(validated);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "turns",
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
