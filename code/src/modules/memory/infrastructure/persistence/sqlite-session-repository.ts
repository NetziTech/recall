import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  Session,
} from "../../domain/aggregates/session.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import { OpenQuestion } from "../../domain/value-objects/open-question.ts";
import { SessionId } from "../../domain/value-objects/session-id.ts";
import { SessionIntent } from "../../domain/value-objects/session-intent.ts";
import { SessionMetadata } from "../../domain/value-objects/session-metadata.ts";
import { SessionNextSeed } from "../../domain/value-objects/session-next-seed.ts";
import { SessionSummary } from "../../domain/value-objects/session-summary.ts";
import { TurnsCount } from "../../domain/value-objects/turns-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const SessionRowSchema = z.object({
  id: z.string().min(1),
  started_at_ms: z.number().int().min(0),
  ended_at_ms: z.number().int().min(0).nullable(),
  intent: z.string().nullable(),
  summary: z.string().nullable(),
  next_seed: z.string().nullable(),
  resumed_from: z.string().nullable(),
  turns_count: z.number().int().min(0),
  metadata_json: z.string(),
});

const OpenQuestionItemSchema = z.object({
  text: z.string().min(1),
  askedAt: z.number().int().min(0),
});

const MetadataJsonSchema = z.object({
  open_questions: z.array(OpenQuestionItemSchema).optional(),
  idle_timeout_ms: z.number().int().min(1).optional(),
  last_activity_ms: z.number().int().min(0).optional(),
});

const SQL_UPSERT = `
INSERT INTO sessions (
  id, started_at_ms, ended_at_ms, intent, summary, next_seed,
  resumed_from, turns_count, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  ended_at_ms    = excluded.ended_at_ms,
  intent         = excluded.intent,
  summary        = excluded.summary,
  next_seed      = excluded.next_seed,
  turns_count    = excluded.turns_count,
  metadata_json  = excluded.metadata_json
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, started_at_ms, ended_at_ms, intent, summary, next_seed,
       resumed_from, turns_count, metadata_json
FROM sessions
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_CURRENT = `
SELECT id, started_at_ms, ended_at_ms, intent, summary, next_seed,
       resumed_from, turns_count, metadata_json
FROM sessions
WHERE ended_at_ms IS NULL
ORDER BY started_at_ms DESC, id DESC
LIMIT 1
`.trim();

const SQL_SELECT_ALL = `
SELECT id, started_at_ms, ended_at_ms, intent, summary, next_seed,
       resumed_from, turns_count, metadata_json
FROM sessions
ORDER BY started_at_ms DESC, id DESC
`.trim();

/**
 * SQLite-backed adapter for `SessionRepository`.
 *
 * Closes the `PendingSessionRepository` stub from the composition
 * root.
 *
 * The `metadata_json` blob carries the open-questions list and TWO
 * non-spec fields the persistence layer needs:
 *
 * - `idle_timeout_ms` — the per-session idle threshold. The aggregate
 *   accepts custom values (`Session.start({ idleTimeoutMs })`); the
 *   schema does not have a dedicated column, so we side-load it here.
 * - `last_activity_ms` — the running cursor `Session.recordActivity`
 *   pins. Without it we could not rehydrate the aggregate's monotonic
 *   timeline check.
 *
 * Both fields fall back to defaults if missing (the migration
 * default `metadata_json = '{}'` rehydrates safely).
 */
export class SqliteSessionRepository implements SessionRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: SessionId): Promise<Session | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("sessions", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(session: Session): Promise<void> {
    const metadataJson = SqliteSessionRepository.serialiseMetadata(
      session.getMetadata(),
      session.getIdleTimeoutMs(),
      session.getLastActivityAt(),
    );
    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        session.getId().toString(),
        session.getStartedAt().toEpochMs(),
        session.getEndedAt()?.toEpochMs() ?? null,
        session.getIntent()?.toString() ?? null,
        session.getSummary()?.toString() ?? null,
        session.getNextSeed()?.toString() ?? null,
        session.getResumedFrom()?.toString() ?? null,
        session.getTurnsCount().toNumber(),
        metadataJson,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("sessions", cause);
    }
    return Promise.resolve();
  }

  public async findCurrentByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<Session | null> {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "sessions",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_CURRENT);
    let row: unknown;
    try {
      row = stmt.get();
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("sessions", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async findAllByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Session[]> {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "sessions",
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
      throw MemoryInfrastructureError.queryFailed("sessions", cause);
    }
    const out: Session[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): Session {
    let parsed: z.infer<typeof SessionRowSchema>;
    try {
      parsed = SessionRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "sessions",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const meta = SqliteSessionRepository.parseMetadata(parsed.metadata_json);
    const startedAt = Timestamp.fromEpochMs(parsed.started_at_ms);
    const endedAt =
      parsed.ended_at_ms === null
        ? null
        : Timestamp.fromEpochMs(parsed.ended_at_ms);
    const idleTimeoutMs = meta.idleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
    const lastActivityAt =
      meta.lastActivityMs === undefined
        ? (endedAt ?? startedAt)
        : Timestamp.fromEpochMs(meta.lastActivityMs);
    return Session.rehydrate({
      id: SessionId.from(parsed.id),
      workspaceId: this.workspaceId,
      startedAt,
      endedAt,
      lastActivityAt,
      idleTimeoutMs,
      intent:
        parsed.intent === null ? null : SessionIntent.from(parsed.intent),
      summary:
        parsed.summary === null ? null : SessionSummary.from(parsed.summary),
      nextSeed:
        parsed.next_seed === null
          ? null
          : SessionNextSeed.from(parsed.next_seed),
      resumedFrom:
        parsed.resumed_from === null
          ? null
          : SessionId.from(parsed.resumed_from),
      turnsCount: TurnsCount.of(parsed.turns_count),
      metadata: meta.metadata,
    });
  }

  private static parseMetadata(rawJson: string): {
    metadata: SessionMetadata;
    idleTimeoutMs?: number;
    lastActivityMs?: number;
  } {
    let parsed: z.infer<typeof MetadataJsonSchema>;
    try {
      const decoded: unknown = JSON.parse(rawJson);
      parsed = MetadataJsonSchema.parse(decoded);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "sessions",
        `metadata_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
    const questions: OpenQuestion[] = [];
    for (const item of parsed.open_questions ?? []) {
      questions.push(
        OpenQuestion.from(item.text, Timestamp.fromEpochMs(item.askedAt)),
      );
    }
    const result: {
      metadata: SessionMetadata;
      idleTimeoutMs?: number;
      lastActivityMs?: number;
    } = {
      metadata: SessionMetadata.of(questions),
    };
    if (parsed.idle_timeout_ms !== undefined) {
      result.idleTimeoutMs = parsed.idle_timeout_ms;
    }
    if (parsed.last_activity_ms !== undefined) {
      result.lastActivityMs = parsed.last_activity_ms;
    }
    return result;
  }

  private static serialiseMetadata(
    metadata: SessionMetadata,
    idleTimeoutMs: number,
    lastActivityAt: Timestamp,
  ): string {
    const open: { text: string; askedAt: number }[] = [];
    for (const q of metadata.openQuestions) {
      open.push({
        text: q.text.toString(),
        askedAt: q.askedAt.toEpochMs(),
      });
    }
    return JSON.stringify({
      open_questions: open,
      idle_timeout_ms: idleTimeoutMs,
      last_activity_ms: lastActivityAt.toEpochMs(),
    });
  }
}
