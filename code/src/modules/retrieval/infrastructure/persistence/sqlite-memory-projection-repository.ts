import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { DecisionId } from "../../../memory/domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../../memory/domain/value-objects/decision-title.ts";
import { EntityDescription } from "../../../memory/domain/value-objects/entity-description.ts";
import { EntityId } from "../../../memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../memory/domain/value-objects/entity-name.ts";
import { LastUsed } from "../../../memory/domain/value-objects/last-used.ts";
import { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
import { OpenQuestion } from "../../../memory/domain/value-objects/open-question.ts";
import { Scope } from "../../../memory/domain/value-objects/scope.ts";
import { SessionId } from "../../../memory/domain/value-objects/session-id.ts";
import { SessionIntent } from "../../../memory/domain/value-objects/session-intent.ts";
import { TaskId } from "../../../memory/domain/value-objects/task-id.ts";
import { TaskPriority } from "../../../memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../../memory/domain/value-objects/task-status.ts";
import { TaskTitle } from "../../../memory/domain/value-objects/task-title.ts";
import { TurnId } from "../../../memory/domain/value-objects/turn-id.ts";
import { TurnSummary } from "../../../memory/domain/value-objects/turn-summary.ts";
import { UseCount } from "../../../memory/domain/value-objects/use-count.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../../application/ports/out/memory-projection-repository.port.ts";
import { DecisionRef } from "../../domain/value-objects/decision-ref.ts";
import { EntityRef } from "../../domain/value-objects/entity-ref.ts";
import { OpenQuestionRef } from "../../domain/value-objects/open-question-ref.ts";
import { type QueryKindValue } from "../../domain/value-objects/query-kind.ts";
import { RelevanceScore } from "../../domain/value-objects/relevance-score.ts";
import { TaskRef } from "../../domain/value-objects/task-ref.ts";
import { TurnRef } from "../../domain/value-objects/turn-ref.ts";
import { WorkspaceAnchorPayload } from "../../domain/value-objects/workspace-anchor-payload.ts";

// ─── Zod schemas ───────────────────────────────────────────────────────

const TagsJsonSchema = z.array(z.string()).readonly();

const DecisionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  // B-MCP-4: migration 008 added this column. Optional in the schema
  // because legacy snapshots from before the migration may still be
  // around in tests; the load path falls back to rationale when
  // absent so the preview never goes empty.
  content: z.string().optional(),
  scope: z.string(),
  module: z.string().nullable(),
  confidence: z.number(),
  last_used_ms: z.number().int(),
  use_count: z.number().int(),
  tags_json: z.string(),
  created_at_ms: z.number().int(),
});

const LearningRowSchema = z.object({
  id: z.string(),
  content: z.string(),
  trigger: z.string().nullable(),
  scope: z.string(),
  module: z.string().nullable(),
  severity: z.string(),
  confidence: z.number(),
  last_used_ms: z.number().int(),
  use_count: z.number().int(),
  tags_json: z.string(),
  created_at_ms: z.number().int(),
});

const EntityRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  entity_kind: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  confidence: z.number(),
  last_used_ms: z.number().int(),
  use_count: z.number().int(),
  tags_json: z.string(),
  created_at_ms: z.number().int(),
});

const TaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  tags_json: z.string(),
  created_at_ms: z.number().int(),
  updated_at_ms: z.number().int(),
});

const TurnRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  recorded_at_ms: z.number().int(),
  summary: z.string(),
  intent: z.string().nullable(),
  outcome: z.string().nullable(),
  confidence: z.number(),
  last_used_ms: z.number().int(),
  use_count: z.number().int(),
  tags_json: z.string(),
});

const WorkspaceConfigRowSchema = z.object({
  workspace_id: z.string(),
  display_name: z.string(),
  mode: z.string(),
  metadata_json: z.string(),
});

const SessionRowSchema = z.object({
  id: z.string(),
  intent: z.string().nullable(),
  started_at_ms: z.number().int(),
  ended_at_ms: z.number().int().nullable(),
  metadata_json: z.string(),
});

// ─── SQL ───────────────────────────────────────────────────────────────

const SQL_LIST_ACTIVE_DECISIONS = `
SELECT id, title, rationale, content, scope, module, confidence,
       last_used_ms, use_count, tags_json, created_at_ms
FROM decisions
WHERE superseded_by IS NULL
ORDER BY use_count DESC, created_at_ms DESC
LIMIT ?
`.trim();

const SQL_LIST_OPEN_TASKS = `
SELECT id, title, description, status, priority,
       tags_json, created_at_ms, updated_at_ms
FROM tasks
WHERE status != 'done'
ORDER BY
  CASE status
    WHEN 'in_progress' THEN 0
    WHEN 'blocked'     THEN 1
    WHEN 'todo'        THEN 2
    WHEN 'pending'     THEN 2
    ELSE 3
  END ASC,
  CASE priority
    WHEN 'critical' THEN 0
    WHEN 'high'     THEN 1
    WHEN 'medium'   THEN 2
    WHEN 'low'      THEN 3
    ELSE 4
  END ASC,
  created_at_ms DESC
LIMIT ?
`.trim();

const SQL_LIST_RECENT_TURNS = `
SELECT id, session_id, recorded_at_ms, summary, intent, outcome,
       confidence, last_used_ms, use_count, tags_json
FROM turns
ORDER BY recorded_at_ms DESC
LIMIT ?
`.trim();

const SQL_LOAD_WORKSPACE_ANCHOR = `
SELECT workspace_id, display_name, mode, metadata_json
FROM workspace_config
WHERE workspace_id = ?
LIMIT 1
`.trim();

const SQL_LOAD_ACTIVE_SESSION = `
SELECT id, intent, started_at_ms, ended_at_ms, metadata_json
FROM sessions
WHERE ended_at_ms IS NULL
ORDER BY started_at_ms DESC
LIMIT 1
`.trim();

const SQL_LIST_RECENT_CLOSED_SESSIONS = `
SELECT id, intent, started_at_ms, ended_at_ms, metadata_json
FROM sessions
WHERE ended_at_ms IS NOT NULL
ORDER BY ended_at_ms DESC
LIMIT ?
`.trim();

const OpenQuestionsJsonSchema = z
  .array(
    z.union([
      z.object({ text: z.string().min(1), askedAt: z.number().int().min(0) }),
      z.string().min(1),
    ]),
  )
  .readonly();

const SQL_BUMP_TEMPLATE = `
UPDATE %TABLE%
SET use_count = use_count + 1,
    last_used_ms = ?
WHERE id = ?
`.trim();

const KIND_TABLE: Readonly<Record<QueryKindValue, string>> = Object.freeze({
  decision: "decisions",
  learning: "learnings",
  entity: "entities",
  task: "tasks",
  turn: "turns",
});

// ─── Adapter ───────────────────────────────────────────────────────────

/**
 * SQLite-backed adapter implementing
 * `MemoryProjectionRepository`.
 *
 * Schema dependency: the memory module's core schema migration owns
 * the base tables (`decisions`, `learnings`, `entities`, `tasks`,
 * `turns`, `sessions`, `workspace_config`) and the FTS5 shadow
 * tables. This adapter assumes those are present at construction.
 *
 * Cross-import policy (ADR-001, `docs/12 §1.5.1`):
 * - The adapter imports VOs from `memory/domain/value-objects/` to
 *   construct the `*Ref` projections it returns. This is the
 *   READ direction explicitly authorised by the ADR. No memory
 *   aggregate (`Decision`, `Learning`, etc.) is instantiated here.
 *
 * Idempotency / concurrency:
 * - Every read method is one round trip per logical query (the
 *   "no N+1" contract of the port). The bulk hydration path
 *   (`loadProjectionsByHits`) groups by kind and issues one UNION
 *   ALL across kinds to keep the round trip count to one.
 * - `bumpUsage` is an UPDATE per row but issued inside a single
 *   transaction so the writes commit together (atomicity of the
 *   recall side-effect).
 *
 * Performance:
 * - The structural reads (`listActiveDecisions`, `listOpenTasks`,
 *   `listRecentTurns`, `listOpenQuestions`) are all SARGable on the
 *   indexes documented in `docs/03-modelo-datos.md` §4. The bundle
 *   assembly fans them out via `Promise.all`.
 */
export class SqliteMemoryProjectionRepository
  implements MemoryProjectionRepository
{
  public constructor(private readonly db: DatabaseConnection) {}

  public loadWorkspaceAnchor(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceAnchorPayload | null> {
    const stmt = this.db.prepare(SQL_LOAD_WORKSPACE_ANCHOR);
    const raw = stmt.get(workspaceId.toString());
    if (raw === undefined) return Promise.resolve(null);
    const parsed = WorkspaceConfigRowSchema.parse(raw);
    if (!WorkspaceAnchorPayload.isModeLabel(parsed.mode)) {
      return Promise.resolve(null);
    }

    const sessStmt = this.db.prepare(SQL_LOAD_ACTIVE_SESSION);
    const sessRaw = sessStmt.get();
    let activeSessionId: SessionId | null = null;
    let activeSessionIntent: SessionIntent | null = null;
    let sessionStartedAt: Timestamp | null = null;
    if (sessRaw !== undefined) {
      const sessParsed = SessionRowSchema.parse(sessRaw);
      activeSessionId = SessionId.from(sessParsed.id);
      sessionStartedAt = Timestamp.fromEpochMs(sessParsed.started_at_ms);
      if (sessParsed.intent !== null) {
        activeSessionIntent = SessionIntent.from(sessParsed.intent);
      }
    }

    const metadata = parseMetadataMap(parsed.metadata_json);

    return Promise.resolve(
      WorkspaceAnchorPayload.of({
        workspaceId: WorkspaceId.from(parsed.workspace_id),
        displayName: WorkspaceDisplayName.from(parsed.display_name),
        mode: parsed.mode,
        activeSessionId,
        activeSessionIntent,
        sessionStartedAt,
        metadata,
      }),
    );
  }

  public listActiveDecisions(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly DecisionRef[]> {
    void input.workspaceId;
    const stmt = this.db.prepare(SQL_LIST_ACTIVE_DECISIONS);
    const rows = stmt.all(input.limit);
    const out: DecisionRef[] = [];
    for (const raw of rows) {
      const parsed = DecisionRowSchema.parse(raw);
      out.push(
        DecisionRef.of({
          id: DecisionId.from(parsed.id),
          title: DecisionTitle.from(parsed.title),
          tags: parseTags(parsed.tags_json),
          scope: Scope.create(parsed.scope, parsed.module),
          confidence: Confidence.of(parsed.confidence),
          relevanceScore: RelevanceScore.zero(),
        }),
      );
    }
    return Promise.resolve(Object.freeze(out));
  }

  public listOpenTasks(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly TaskRef[]> {
    void input.workspaceId;
    const stmt = this.db.prepare(SQL_LIST_OPEN_TASKS);
    const rows = stmt.all(input.limit);
    const out: TaskRef[] = [];
    for (const raw of rows) {
      const parsed = TaskRowSchema.parse(raw);
      out.push(
        TaskRef.of({
          id: TaskId.from(parsed.id),
          title: TaskTitle.from(parsed.title),
          status: TaskStatus.create(parsed.status),
          priority: TaskPriority.create(parsed.priority),
          tags: parseTags(parsed.tags_json),
          relevanceScore: RelevanceScore.zero(),
        }),
      );
    }
    return Promise.resolve(Object.freeze(out));
  }

  public listRecentTurns(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly TurnRef[]> {
    void input.workspaceId;
    const stmt = this.db.prepare(SQL_LIST_RECENT_TURNS);
    const rows = stmt.all(input.limit);
    const out: TurnRef[] = [];
    for (const raw of rows) {
      const parsed = TurnRowSchema.parse(raw);
      out.push(
        TurnRef.of({
          id: TurnId.from(parsed.id),
          summary: TurnSummary.from(parsed.summary),
          recordedAt: Timestamp.fromEpochMs(parsed.recorded_at_ms),
          confidence: Confidence.of(parsed.confidence),
          tags: parseTags(parsed.tags_json),
          relevanceScore: RelevanceScore.zero(),
        }),
      );
    }
    return Promise.resolve(Object.freeze(out));
  }

  public listOpenQuestions(input: {
    workspaceId: WorkspaceId;
    sessionLimit: number;
    limit: number;
  }): Promise<readonly OpenQuestionRef[]> {
    void input.workspaceId;
    const stmt = this.db.prepare(SQL_LIST_RECENT_CLOSED_SESSIONS);
    const rows = stmt.all(input.sessionLimit);
    const out: OpenQuestionRef[] = [];
    for (const raw of rows) {
      const parsed = SessionRowSchema.parse(raw);
      const questions = parseOpenQuestions(parsed.metadata_json);
      const sessionId = SessionId.from(parsed.id);
      const recordedAt = Timestamp.fromEpochMs(
        parsed.ended_at_ms ?? parsed.started_at_ms,
      );
      for (const q of questions) {
        if (out.length >= input.limit) break;
        out.push(
          OpenQuestionRef.of({
            sessionId,
            question: OpenQuestion.from(q.text, q.askedAt),
            recordedAt,
          }),
        );
      }
      if (out.length >= input.limit) break;
    }
    return Promise.resolve(Object.freeze(out));
  }

  public loadProjectionsByHits(input: {
    workspaceId: WorkspaceId;
    hits: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<readonly MemoryProjection[]> {
    void input.workspaceId;
    if (input.hits.length === 0) return Promise.resolve(Object.freeze([]));

    const grouped: Record<QueryKindValue, string[]> = {
      decision: [],
      learning: [],
      entity: [],
      task: [],
      turn: [],
    };
    for (const hit of input.hits) {
      grouped[hit.kind].push(hit.id);
    }

    const projections: MemoryProjection[] = [];
    if (grouped.decision.length > 0) {
      this.loadDecisions(grouped.decision, projections);
    }
    if (grouped.learning.length > 0) {
      this.loadLearnings(grouped.learning, projections);
    }
    if (grouped.entity.length > 0) {
      this.loadEntities(grouped.entity, projections);
    }
    if (grouped.task.length > 0) {
      this.loadTasks(grouped.task, projections);
    }
    if (grouped.turn.length > 0) {
      this.loadTurns(grouped.turn, projections);
    }

    // Re-order to match the input hit order.
    const projIndex = new Map<string, MemoryProjection>();
    for (const p of projections) {
      projIndex.set(`${p.kind}::${p.id}`, p);
    }
    const ordered: MemoryProjection[] = [];
    for (const hit of input.hits) {
      const got = projIndex.get(`${hit.kind}::${hit.id}`);
      if (got !== undefined) ordered.push(got);
    }
    return Promise.resolve(Object.freeze(ordered));
  }

  public loadEntityRefsByIds(input: {
    workspaceId: WorkspaceId;
    ids: readonly string[];
  }): Promise<readonly EntityRef[]> {
    void input.workspaceId;
    if (input.ids.length === 0) return Promise.resolve(Object.freeze([]));
    const placeholders = input.ids.map(() => "?").join(", ");
    const sql = `
SELECT id, name, entity_kind, description, location, confidence,
       last_used_ms, use_count, tags_json, created_at_ms
FROM entities
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...input.ids);
    const out: EntityRef[] = [];
    for (const raw of rows) {
      const parsed = EntityRowSchema.parse(raw);
      out.push(
        EntityRef.of({
          id: EntityId.from(parsed.id),
          name: EntityName.from(parsed.name),
          entityKind: EntityKind.create(parsed.entity_kind),
          description:
            parsed.description.length === 0
              ? EntityDescription.unknown()
              : EntityDescription.of(parsed.description),
          location: parsed.location,
          confidence: Confidence.of(parsed.confidence),
          relevanceScore: RelevanceScore.zero(),
        }),
      );
    }
    return Promise.resolve(Object.freeze(out));
  }

  public bumpUsage(input: {
    workspaceId: WorkspaceId;
    touched: readonly { readonly kind: QueryKindValue; readonly id: string }[];
    at: Timestamp;
  }): Promise<void> {
    void input.workspaceId;
    if (input.touched.length === 0) return Promise.resolve();
    const at = input.at.epochMs;
    this.db.transaction((): void => {
      for (const t of input.touched) {
        const sql = SQL_BUMP_TEMPLATE.replace("%TABLE%", KIND_TABLE[t.kind]);
        const stmt = this.db.prepare(sql);
        stmt.run(at, t.id);
      }
    });
    return Promise.resolve();
  }

  // -- internal hydrators ----------------------------------------------

  private loadDecisions(ids: readonly string[], out: MemoryProjection[]): void {
    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
SELECT id, title, rationale, content, scope, module, confidence,
       last_used_ms, use_count, tags_json, created_at_ms
FROM decisions
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...ids);
    for (const raw of rows) {
      const parsed = DecisionRowSchema.parse(raw);
      out.push({
        kind: "decision",
        id: parsed.id,
        title: parsed.title,
        // B-MCP-4 (issue #3): the wire `content` field now reflects the
        // full body the client supplied to `mem.remember`. Pre-migration
        // rows fall back to `rationale` (which migration 008 also
        // copied into `content` during backfill, so the two paths
        // converge for legacy data).
        preview: truncatePreview(parsed.content ?? parsed.rationale),
        tags: parseTags(parsed.tags_json),
        confidence: Confidence.of(parsed.confidence),
        useCount: UseCount.of(parsed.use_count),
        lastUsedAt: lastUsedFromMs(parsed.last_used_ms),
        createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
        severity: null,
      });
    }
  }

  private loadLearnings(ids: readonly string[], out: MemoryProjection[]): void {
    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
SELECT id, content, trigger, scope, module, severity, confidence,
       last_used_ms, use_count, tags_json, created_at_ms
FROM learnings
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...ids);
    for (const raw of rows) {
      const parsed = LearningRowSchema.parse(raw);
      const severity = LearningSeverity.isKind(parsed.severity)
        ? LearningSeverity.create(parsed.severity)
        : LearningSeverity.tip();
      out.push({
        kind: "learning",
        id: parsed.id,
        title: previewTitle(parsed.content),
        preview: parsed.content,
        tags: parseTags(parsed.tags_json),
        confidence: Confidence.of(parsed.confidence),
        useCount: UseCount.of(parsed.use_count),
        lastUsedAt: lastUsedFromMs(parsed.last_used_ms),
        createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
        severity,
      });
    }
  }

  private loadEntities(ids: readonly string[], out: MemoryProjection[]): void {
    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
SELECT id, name, entity_kind, description, location, confidence,
       last_used_ms, use_count, tags_json, created_at_ms
FROM entities
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...ids);
    for (const raw of rows) {
      const parsed = EntityRowSchema.parse(raw);
      out.push({
        kind: "entity",
        id: parsed.id,
        title: parsed.name,
        preview:
          parsed.description.length === 0
            ? `${parsed.name} (${parsed.entity_kind})`
            : truncatePreview(parsed.description),
        tags: parseTags(parsed.tags_json),
        confidence: Confidence.of(parsed.confidence),
        useCount: UseCount.of(parsed.use_count),
        lastUsedAt: lastUsedFromMs(parsed.last_used_ms),
        createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
        severity: null,
      });
    }
  }

  private loadTasks(ids: readonly string[], out: MemoryProjection[]): void {
    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
SELECT id, title, description, status, priority,
       tags_json, created_at_ms, updated_at_ms
FROM tasks
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...ids);
    for (const raw of rows) {
      const parsed = TaskRowSchema.parse(raw);
      out.push({
        kind: "task",
        id: parsed.id,
        title: parsed.title,
        preview:
          parsed.description === null
            ? `[${parsed.status}] ${parsed.title}`
            : truncatePreview(parsed.description),
        tags: parseTags(parsed.tags_json),
        // Tasks lack a confidence column in the spec; pin to full so
        // the recall scorer treats them as fresh signals. Curator
        // does not decay tasks (they are status-driven).
        confidence: Confidence.full(),
        useCount: UseCount.zero(),
        lastUsedAt: LastUsed.at(Timestamp.fromEpochMs(parsed.updated_at_ms)),
        createdAt: Timestamp.fromEpochMs(parsed.created_at_ms),
        severity: null,
      });
    }
  }

  private loadTurns(ids: readonly string[], out: MemoryProjection[]): void {
    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
SELECT id, session_id, recorded_at_ms, summary, intent, outcome,
       confidence, last_used_ms, use_count, tags_json
FROM turns
WHERE id IN (${placeholders})
`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...ids);
    for (const raw of rows) {
      const parsed = TurnRowSchema.parse(raw);
      const intentStr = parsed.intent ?? "";
      const outcomeStr = parsed.outcome ?? "";
      const previewParts = [parsed.summary, intentStr, outcomeStr].filter(
        (p) => p.length > 0,
      );
      out.push({
        kind: "turn",
        id: parsed.id,
        title: previewTitle(parsed.summary),
        preview: previewParts.join("\n"),
        tags: parseTags(parsed.tags_json),
        confidence: Confidence.of(parsed.confidence),
        useCount: UseCount.of(parsed.use_count),
        lastUsedAt: lastUsedFromMs(parsed.last_used_ms),
        createdAt: Timestamp.fromEpochMs(parsed.recorded_at_ms),
        severity: null,
      });
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Parses the `tags_json` TEXT column into a `Tags` VO. Empty arrays
 * map to `Tags.empty()`. Tampered JSON throws via Zod.
 */
function parseTags(raw: string): Tags {
  const parsed: unknown = JSON.parse(raw);
  const validated = TagsJsonSchema.parse(parsed);
  if (validated.length === 0) return Tags.empty();
  return Tags.create(validated);
}

/**
 * Parses the `metadata_json` blob into a flat `Record<string, string>`.
 * Drops keys whose value is not a string (the
 * `WorkspaceAnchorPayload` factory enforces a flat string-shaped
 * record).
 */
function parseMetadataMap(raw: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

interface OpenQuestionPayload {
  readonly text: string;
  readonly askedAt: Timestamp;
}

/**
 * Parses the `metadata_json.open_questions` field. Tolerates two
 * shapes:
 *   - `{ text: "...", askedAt: <epoch_ms> }` (rich form).
 *   - `"..."` (legacy bare string — askedAt defaults to the session's
 *     start_at_ms; the caller fills it in).
 */
function parseOpenQuestions(raw: string): readonly OpenQuestionPayload[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const meta = parsed as Record<string, unknown>;
  const block = meta["open_questions"];
  if (!Array.isArray(block)) return [];
  let validated: ReturnType<typeof OpenQuestionsJsonSchema.parse>;
  try {
    validated = OpenQuestionsJsonSchema.parse(block);
  } catch {
    return [];
  }
  const out: OpenQuestionPayload[] = [];
  for (const item of validated) {
    if (typeof item === "string") {
      out.push({ text: item, askedAt: Timestamp.fromEpochMs(0) });
    } else {
      out.push({
        text: item.text,
        askedAt: Timestamp.fromEpochMs(item.askedAt),
      });
    }
  }
  return out;
}

/**
 * Materialises a `LastUsed` VO from the persisted `last_used_ms`
 * column. The schema makes the column NOT NULL (entries are stamped
 * with their `created_at_ms` on insert), so we treat it as "always
 * used at" — the never-used case is invisible at this layer.
 */
function lastUsedFromMs(raw: number): LastUsed {
  return LastUsed.at(Timestamp.fromEpochMs(raw));
}

/**
 * Hard cap on the rendered preview to keep token counts bounded
 * before the layer-budget pass kicks in. The 600-char cap matches
 * the per-layer budgets of `docs/04-capas-contexto.md` §2.
 */
function truncatePreview(raw: string): string {
  if (raw.length <= 600) return raw;
  return raw.slice(0, 600);
}

/**
 * Picks a single-line preview from a multi-line content string —
 * used for `learning` and `turn` rows whose first sentence is the
 * title-equivalent.
 */
function previewTitle(raw: string): string {
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? raw.trim();
  if (firstLine.length === 0) return raw.slice(0, 80);
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 80);
}

// ─── Local VO ──────────────────────────────────────────────────────────

/**
 * Tiny wrapper VO for the workspace's `display_name`. The retrieval
 * domain's `WorkspaceAnchorPayload` requires a `NonEmptyString`
 * subclass, but the workspace domain (Tarea 3.5) owns the canonical
 * `WorkspaceDisplayName`. Re-defining a wrapper here avoids importing
 * from a sibling module that ADR-001 does not authorise.
 *
 * The local VO will collapse to the workspace module's class once
 * Tarea 3.5 lands and the composition root unifies them.
 */
class WorkspaceDisplayName extends NonEmptyString {
  public static from(raw: string): WorkspaceDisplayName {
    const trimmed = NonEmptyString.normalize(raw, "display_name");
    return new WorkspaceDisplayName(trimmed);
  }
}
