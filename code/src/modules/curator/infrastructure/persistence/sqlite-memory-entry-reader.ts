import { z } from "zod";

import type {
  DatabaseConnection,
  PreparedStatement,
} from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
// `LearningSeverity` is used both as a type AND as a value (factory call
// in `parseLearningRow`); the linter's auto-fix would split the import,
// but the value form is required.
import type {
  EntityLocationProjection,
  MemoryEntryProjection,
  MemoryEntryReader,
} from "../../application/ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Per-kind row schemas. The schemas validate every column the curator
 * inspects (`confidence`, `last_used_ms`, `use_count`, `created_at_ms`,
 * plus the per-kind discriminators) and reject anything else as
 * malformed. Mirrors the live tables documented in
 * `docs/03-modelo-datos.md` §4.2-§4.7. Columns that exist in the
 * spec but the curator does NOT care about (`title`, `rationale`,
 * `alternatives_rejected`, ...) are omitted from the schema; if the
 * persistence layer adds a new field the curator will simply not
 * notice — that is the desired behaviour.
 *
 * Note on `workspace_id`:
 * - The persistent tables for `decisions`, `learnings`, `entities`,
 *   `tasks`, `turns` do NOT carry a `workspace_id` column: per
 *   `docs/03-modelo-datos.md` §4.1, "no hay `workspace_id` porque
 *   toda la DB ES el workspace". The reader therefore ignores the
 *   `workspaceId` argument from the port at the SQL level and
 *   trusts the connection-level scoping. The `workspaceId` is still
 *   threaded through the projections so the writer can persist
 *   matching `pruned` rows (whose schema DOES carry the workspace
 *   id, since `pruned` is curator-owned).
 */

/** Common fields the curator inspects for `decisions`. */
const DecisionRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  created_at_ms: z.number().int().min(0),
  tags_json: z.string(),
  title: z.string().min(1),
  rationale: z.string(),
});

const LearningRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  created_at_ms: z.number().int().min(0),
  tags_json: z.string(),
  severity: z.string().min(1),
  content: z.string().min(1),
});

const EntityRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  created_at_ms: z.number().int().min(0),
  tags_json: z.string(),
  name: z.string().min(1),
  entity_kind: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
});

const TaskRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number().nullable(),
  last_used_ms: z.number().int().min(0).nullable(),
  use_count: z.number().int().min(0).nullable(),
  created_at_ms: z.number().int().min(0),
  tags_json: z.string(),
  title: z.string().min(1),
});

const TurnRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number(),
  last_used_ms: z.number().int().min(0),
  use_count: z.number().int().min(0),
  recorded_at_ms: z.number().int().min(0),
  tags_json: z.string(),
  summary: z.string().min(1),
});

const EntityLocationRowSchema = z.object({
  id: z.string().min(1),
  location: z.string().min(1),
});

const TagsArraySchema = z.array(z.string().min(1));

// SQL — eager listing paths (one SELECT per kind).

const SQL_LIST_DECISIONS = `
SELECT id, confidence, last_used_ms, use_count, created_at_ms, tags_json, title, rationale
FROM decisions
WHERE superseded_by IS NULL
ORDER BY id
`.trim();

const SQL_LIST_LEARNINGS = `
SELECT id, confidence, last_used_ms, use_count, created_at_ms, tags_json, severity, content
FROM learnings
WHERE consolidated_into IS NULL
ORDER BY id
`.trim();

const SQL_LIST_ENTITIES = `
SELECT id, confidence, last_used_ms, use_count, created_at_ms, tags_json, name, entity_kind, description, location
FROM entities
ORDER BY id
`.trim();

// `tasks` does NOT carry decay-related columns in the live schema
// (`migrations/004__core-memory-schema.sql` §7 — only id, title,
// description, status, priority, created_at_ms, updated_at_ms,
// completed_at_ms, blocked_by_json, notes_json, tags_json). The
// curator's domain decision is that tasks have NO decay
// (`DecayFactor.forKind("task", null)` is always unity, short-circuited
// at `factor.isUnity()`), so the calculator never reads these fields
// for tasks anyway. The SELECT therefore SYNTHESISES the columns the
// row schema expects (`1.0 AS confidence, created_at_ms AS
// last_used_ms, 0 AS use_count`) so the projection shape stays uniform
// without mutating the table. `parseTaskRow` already tolerates these
// defaults via its `?? 1` / `?? created_at_ms` / `?? 0` fallbacks; the
// SQL alias removes the dependency on non-existent columns at probe
// time, fixing the `SQLITE_ERROR: no such column: confidence` raised
// when `ApplyDecayUseCase` lists the `task` kind.
const SQL_LIST_TASKS = `
SELECT id, 1.0 AS confidence, created_at_ms AS last_used_ms, 0 AS use_count, created_at_ms, tags_json, title
FROM tasks
ORDER BY id
`.trim();

const SQL_LIST_TURNS = `
SELECT id, confidence, last_used_ms, use_count, recorded_at_ms, tags_json, summary
FROM turns
ORDER BY id
`.trim();

// SQL — `prune candidates` paths (kind dispatched at the use-case level)

const SQL_LIST_PRUNE_LEARNINGS = `
SELECT id, confidence, last_used_ms, use_count, created_at_ms, tags_json, severity, content
FROM learnings
WHERE consolidated_into IS NULL
  AND confidence < ?
  AND use_count = 0
  AND created_at_ms <= ?
`.trim();

const SQL_LIST_PRUNE_TURNS = `
SELECT id, confidence, last_used_ms, use_count, recorded_at_ms, tags_json, summary
FROM turns
WHERE confidence < ?
  AND use_count = 0
  AND recorded_at_ms <= ?
`.trim();

// SQL — entity-location path for self-heal

const SQL_LIST_ENTITY_LOCATIONS = `
SELECT id, location
FROM entities
WHERE location IS NOT NULL AND location <> ''
`.trim();

/**
 * Adapter that fulfils the `MemoryEntryReader` driving port using a
 * single SQLite connection.
 *
 * Responsibilities:
 * - Cross-imports `memory/domain` (authorised by ADR-001) for the
 *   `LearningSeverity` VO. No memory aggregate is ever loaded — the
 *   reader keeps every row inside a flat projection.
 * - Routes per-kind listing to the appropriate prepared statement.
 *   The curator's contract is "list every active entry of `kind`";
 *   "active" means:
 *     - `decision`     : `superseded_by IS NULL`
 *     - `learning`     : `consolidated_into IS NULL`
 *     - `entity`       : (every row — entities have no soft-delete)
 *     - `task`         : (every row — task status is opaque to the
 *                         curator's MVP; `task` defaults to no-decay)
 *     - `turn`         : (every row — turns have no soft-delete)
 * - Projects rows to `MemoryEntryProjection`. Tags are decoded from
 *   `tags_json` via a Zod schema so a corrupt payload is caught
 *   before it reaches the calculator.
 *
 * Concurrency:
 * - The adapter holds NO statement handles between calls; each method
 *   prepares a fresh statement. `better-sqlite3-multiple-ciphers`
 *   caches the compiled SQL inside the connection, so the cost is
 *   negligible.
 *
 * Error handling:
 * - Row validation failures raise
 *   `CuratorInfrastructureError.rowMalformed(...)` so the application
 *   layer can route on the code without parsing a free-form message.
 */
export class SqliteMemoryEntryReader implements MemoryEntryReader {
  public constructor(private readonly db: DatabaseConnection) {}

  public async listActiveByKind(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
  }): Promise<readonly MemoryEntryProjection[]> {
    // Uses `stmt.all()` (eager) — never `stmt.iterate()` — so the
    // underlying SQLite cursor closes before any caller-issued write
    // runs on the same connection. See port JSDoc for the
    // `REQUIRE_DATABASE_NO_ITERATORS_UNLESS_UNSAFE` rationale (Bug F).
    const stmt = this.prepareListStmt(input.kind);
    const rows = stmt.all();
    const out: MemoryEntryProjection[] = [];
    for (const row of rows) {
      out.push(this.parseProjection(row, input.workspaceId, input.kind));
    }
    return Promise.resolve(Object.freeze(out));
  }

  public async listPruneCandidates(input: {
    workspaceId: WorkspaceId;
    pruneableKinds: readonly MemoryEntryKind[];
    confidenceBelow: Confidence;
    cutoffMs: number;
  }): Promise<readonly MemoryEntryProjection[]> {
    const out: MemoryEntryProjection[] = [];
    for (const kind of input.pruneableKinds) {
      if (kind.isLearning()) {
        const stmt = this.db.prepare(SQL_LIST_PRUNE_LEARNINGS);
        const rows = stmt.all(input.confidenceBelow.toNumber(), input.cutoffMs);
        for (const row of rows) {
          out.push(this.parseProjection(row, input.workspaceId, kind));
        }
      } else if (kind.isTurn()) {
        const stmt = this.db.prepare(SQL_LIST_PRUNE_TURNS);
        const rows = stmt.all(input.confidenceBelow.toNumber(), input.cutoffMs);
        for (const row of rows) {
          out.push(this.parseProjection(row, input.workspaceId, kind));
        }
      } else {
        // The curator domain forbids auto-pruning for the other kinds;
        // surfacing here protects against a caller mismatch.
        throw CuratorInfrastructureError.unsupportedKind(
          "listPruneCandidates",
          kind.toString(),
        );
      }
    }
    return Promise.resolve(Object.freeze(out));
  }

  public async listEntityLocations(input: {
    workspaceId: WorkspaceId;
  }): Promise<readonly EntityLocationProjection[]> {
    const stmt = this.db.prepare(SQL_LIST_ENTITY_LOCATIONS);
    const rows = stmt.all();
    const out: EntityLocationProjection[] = [];
    for (const row of rows) {
      let parsed: z.infer<typeof EntityLocationRowSchema>;
      try {
        parsed = EntityLocationRowSchema.parse(row);
      } catch (cause: unknown) {
        throw CuratorInfrastructureError.rowMalformed(
          "entities",
          cause instanceof Error ? cause.message : "schema parse failed",
          cause,
        );
      }
      out.push({
        workspaceId: input.workspaceId,
        entityId: parsed.id,
        location: parsed.location,
      });
    }
    return Promise.resolve(Object.freeze(out));
  }

  // -- internals --------------------------------------------------------

  private prepareListStmt(kind: MemoryEntryKind): PreparedStatement {
    if (kind.isDecision()) return this.db.prepare(SQL_LIST_DECISIONS);
    if (kind.isLearning()) return this.db.prepare(SQL_LIST_LEARNINGS);
    if (kind.isEntity()) return this.db.prepare(SQL_LIST_ENTITIES);
    if (kind.isTask()) return this.db.prepare(SQL_LIST_TASKS);
    if (kind.isTurn()) return this.db.prepare(SQL_LIST_TURNS);
    throw CuratorInfrastructureError.unsupportedKind(
      "listActiveByKind",
      kind.toString(),
    );
  }

  private parseProjection(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    if (kind.isDecision()) return this.parseDecisionRow(raw, workspaceId, kind);
    if (kind.isLearning()) return this.parseLearningRow(raw, workspaceId, kind);
    if (kind.isEntity()) return this.parseEntityRow(raw, workspaceId, kind);
    if (kind.isTask()) return this.parseTaskRow(raw, workspaceId, kind);
    if (kind.isTurn()) return this.parseTurnRow(raw, workspaceId, kind);
    throw CuratorInfrastructureError.unsupportedKind(
      "parseProjection",
      kind.toString(),
    );
  }

  private parseDecisionRow(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    const parsed = this.parseSchema(DecisionRowSchema, "decisions", raw);
    return {
      workspaceId,
      kind,
      id: parsed.id,
      confidence: Confidence.of(parsed.confidence),
      lastUsedMs: parsed.last_used_ms,
      useCount: parsed.use_count,
      createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
      severity: null,
      tags: this.parseTags(parsed.tags_json, "decisions"),
      contentSnapshot: this.serialiseDecision(parsed),
    };
  }

  private parseLearningRow(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    const parsed = this.parseSchema(LearningRowSchema, "learnings", raw);
    return {
      workspaceId,
      kind,
      id: parsed.id,
      confidence: Confidence.of(parsed.confidence),
      lastUsedMs: parsed.last_used_ms,
      useCount: parsed.use_count,
      createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
      severity: LearningSeverity.create(parsed.severity),
      tags: this.parseTags(parsed.tags_json, "learnings"),
      contentSnapshot: this.serialiseLearning(parsed),
    };
  }

  private parseEntityRow(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    const parsed = this.parseSchema(EntityRowSchema, "entities", raw);
    return {
      workspaceId,
      kind,
      id: parsed.id,
      confidence: Confidence.of(parsed.confidence),
      lastUsedMs: parsed.last_used_ms,
      useCount: parsed.use_count,
      createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
      severity: null,
      tags: this.parseTags(parsed.tags_json, "entities"),
      contentSnapshot: this.serialiseEntity(parsed),
    };
  }

  private parseTaskRow(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    const parsed = this.parseSchema(TaskRowSchema, "tasks", raw);
    // Tasks may not carry confidence/last_used in the spec; default to
    // unity / created_at so the calculator's no-decay branch fires.
    const confidenceValue = parsed.confidence ?? 1;
    const lastUsedMs = parsed.last_used_ms ?? parsed.created_at_ms;
    const useCount = parsed.use_count ?? 0;
    return {
      workspaceId,
      kind,
      id: parsed.id,
      confidence: Confidence.of(confidenceValue),
      lastUsedMs,
      useCount,
      createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
      severity: null,
      tags: this.parseTags(parsed.tags_json, "tasks"),
      contentSnapshot: this.serialiseTask(parsed),
    };
  }

  private parseTurnRow(
    raw: unknown,
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): MemoryEntryProjection {
    const parsed = this.parseSchema(TurnRowSchema, "turns", raw);
    return {
      workspaceId,
      kind,
      id: parsed.id,
      confidence: Confidence.of(parsed.confidence),
      lastUsedMs: parsed.last_used_ms,
      useCount: parsed.use_count,
      // turns store `recorded_at_ms` instead of `created_at_ms`. The
      // semantic for the curator is identical — "moment the entry came
      // into existence" — so we adapt at the boundary.
      createdAt: Timestamp.fromEpochMs(parsed.recorded_at_ms),
      severity: null,
      tags: this.parseTags(parsed.tags_json, "turns"),
      contentSnapshot: this.serialiseTurn(parsed),
    };
  }

  private parseSchema<T extends z.ZodType>(
    schema: T,
    table: string,
    raw: unknown,
  ): z.infer<T> {
    try {
      return schema.parse(raw);
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        table,
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
  }

  private parseTags(rawJson: string, table: string): readonly string[] {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = TagsArraySchema.parse(decoded);
      return Object.freeze([...validated]);
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        table,
        `tags_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }

  // The "snapshot" forms below intentionally re-encode the row to JSON
  // so the `pruned` table preserves a self-describing audit
  // representation. The format is opaque to the curator domain — the
  // round-trip is "snapshot-only".

  private serialiseDecision(
    row: z.infer<typeof DecisionRowSchema>,
  ): string {
    return JSON.stringify({
      kind: "decision",
      id: row.id,
      title: row.title,
      rationale: row.rationale,
      confidence: row.confidence,
      use_count: row.use_count,
    });
  }

  private serialiseLearning(
    row: z.infer<typeof LearningRowSchema>,
  ): string {
    return JSON.stringify({
      kind: "learning",
      id: row.id,
      content: row.content,
      severity: row.severity,
      confidence: row.confidence,
      use_count: row.use_count,
    });
  }

  private serialiseEntity(
    row: z.infer<typeof EntityRowSchema>,
  ): string {
    return JSON.stringify({
      kind: "entity",
      id: row.id,
      name: row.name,
      entity_kind: row.entity_kind,
      description: row.description,
      location: row.location,
      confidence: row.confidence,
      use_count: row.use_count,
    });
  }

  private serialiseTask(row: z.infer<typeof TaskRowSchema>): string {
    return JSON.stringify({
      kind: "task",
      id: row.id,
      title: row.title,
      created_at_ms: row.created_at_ms,
    });
  }

  private serialiseTurn(row: z.infer<typeof TurnRowSchema>): string {
    return JSON.stringify({
      kind: "turn",
      id: row.id,
      summary: row.summary,
      confidence: row.confidence,
      use_count: row.use_count,
      recorded_at_ms: row.recorded_at_ms,
    });
  }
}
