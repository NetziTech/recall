import type { Confidence } from "../../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { LastUsed } from "../../../../memory/domain/value-objects/last-used.ts";
import type { LearningSeverity } from "../../../../memory/domain/value-objects/learning-severity.ts";
import type { UseCount } from "../../../../memory/domain/value-objects/use-count.ts";
import type { DecisionRef } from "../../../domain/value-objects/decision-ref.ts";
import type { EntityRef } from "../../../domain/value-objects/entity-ref.ts";
import type { OpenQuestionRef } from "../../../domain/value-objects/open-question-ref.ts";
import type { QueryKindValue } from "../../../domain/value-objects/query-kind.ts";
import type { TaskRef } from "../../../domain/value-objects/task-ref.ts";
import type { TurnRef } from "../../../domain/value-objects/turn-ref.ts";
import type { WorkspaceAnchorPayload } from "../../../domain/value-objects/workspace-anchor-payload.ts";

/**
 * Driven (output) port: read-only projection access into the memory
 * bounded context.
 *
 * Why this port exists separately from the domain `LexicalSearch` /
 * `VectorSearch` ports:
 *
 * - `LexicalSearch` and `VectorSearch` return *opaque hits* (kind + id
 *   + score) — they answer "which entries match this signal?" and
 *   nothing else.
 * - Building the seven-layer `ContextBundle` requires reading the
 *   denormalised projections of those entries (title, tags, scope,
 *   confidence, last-used, ...) PLUS structured queries that are not
 *   query-driven at all (e.g. "give me the open tasks of this
 *   workspace ordered by priority/status" for Capa 3).
 * - Funnelling both through one port (a) keeps the application use
 *   cases unaware of the SQLite schema details and (b) lets the test
 *   suite swap a single in-memory fake for the whole memory read
 *   surface.
 *
 * Cross-import policy (ADR-001, `docs/12 §1.5.1`):
 * - This port returns ONLY `*Ref` projections owned by `retrieval/
 *   domain/` plus typed identifiers from `memory/domain/`. It does NOT
 *   surface `Decision`, `Learning`, `Entity`, `Task`, `Turn`, or
 *   `Session` aggregates (the upstream-downstream Customer-Supplier
 *   boundary forbids it). Adapters MUST construct `*Ref` directly from
 *   row data and NEVER instantiate a memory aggregate at this layer.
 *
 * Concurrency / N+1 contract:
 * - Each method is one round trip. Implementations MAY pipeline
 *   internal queries but MUST NOT issue per-row follow-up reads — the
 *   `RecallMemoryUseCase` and `GetContextBundleUseCase` rely on this
 *   contract to meet the p95 < 100 ms (`mem.recall`) and < 200 ms
 *   (`mem.context`) targets in `docs/01-arquitectura.md` §10.
 *
 * Implementations:
 * - `infrastructure/persistence/sqlite-memory-projection-repository.ts`
 *   wraps the `SqliteDatabase` adapter from `shared/`.
 * - Tests use an in-memory fake that returns hand-built `*Ref` arrays.
 */
export interface MemoryProjectionRepository {
  /**
   * Loads the workspace's anchor payload for layer 1
   * (`workspace_anchor`). Returns `null` when the workspace is unknown
   * (the use case typically promotes that to a domain error).
   */
  loadWorkspaceAnchor(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceAnchorPayload | null>;

  /**
   * Returns the active (non-superseded) decisions for the project
   * constitution layer (Capa 2). Sorted by `use_count DESC` per
   * `docs/04-capas-contexto.md` §3.2.
   *
   * @param workspaceId - the workspace bounding the query.
   * @param limit - hard cap on the number of refs returned.
   */
  listActiveDecisions(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly DecisionRef[]>;

  /**
   * Returns the open (non-done) tasks for the active-tasks layer
   * (Capa 3). Sorted in_progress > blocked > todo, then by priority
   * DESC (per `docs/04-capas-contexto.md` §3.3).
   */
  listOpenTasks(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly TaskRef[]>;

  /**
   * Returns the most recent turns for the recent-turns layer
   * (Capa 4). Sorted by `recorded_at_ms DESC`.
   */
  listRecentTurns(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<readonly TurnRef[]>;

  /**
   * Returns the open questions of the last `sessionLimit` closed
   * sessions for the open-questions layer (Capa 7). Sorted by
   * `recordedAt DESC`.
   *
   * Implementations: read `sessions.metadata_json.open_questions`,
   * flatten into a single list across the latest closed sessions,
   * and cap by `limit`.
   */
  listOpenQuestions(input: {
    workspaceId: WorkspaceId;
    sessionLimit: number;
    limit: number;
  }): Promise<readonly OpenQuestionRef[]>;

  /**
   * Hydrates a batch of search hits into typed projections used by
   * the recall pipeline.
   *
   * The adapter looks up each `(kind, id)` tuple in the corresponding
   * SQLite table (one CTE per kind, ideally a single round trip) and
   * returns a frozen array of `MemoryProjection` rows. Hits whose row
   * is missing (race with the curator's prune) are silently dropped.
   *
   * Order of the returned array matches the order of the input.
   */
  loadProjectionsByHits(input: {
    workspaceId: WorkspaceId;
    hits: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<readonly MemoryProjection[]>;

  /**
   * Hydrates a batch of entity ids into `EntityRef`s for the Code Map
   * layer (Capa 6). Used after the vector-search hits have been
   * filtered to the entity kind.
   */
  loadEntityRefsByIds(input: {
    workspaceId: WorkspaceId;
    ids: readonly string[];
  }): Promise<readonly EntityRef[]>;

  /**
   * Bumps the `use_count` and `last_used_ms` columns of every entry
   * touched by a `mem.recall` invocation. Implementations MUST batch
   * the writes (one statement per kind, parameterised by id list).
   *
   * Why on this port: the recall pipeline is a read-mostly path, but
   * its side-effect (touching the use counts) is part of the hybrid
   * scoring loop documented in `docs/01-arquitectura.md` §2.6
   * (`usage_frequency`). Putting the bump on the same port as the
   * reads keeps the use case unaware of which adapter owns which
   * table.
   */
  bumpUsage(input: {
    workspaceId: WorkspaceId;
    touched: readonly { readonly kind: QueryKindValue; readonly id: string }[];
    at: Timestamp;
  }): Promise<void>;
}

/**
 * Row-shaped projection of a memory entry as needed by the recall
 * ranking and bundle-assembly pipelines.
 *
 * The shape is intentionally NOT one of the `*Ref` VOs: those VOs are
 * the *output* of the application layer (they carry a final
 * `RelevanceScore`), while this projection is an *input* — a
 * denormalised row the application layer rescores before producing a
 * ref. The two shapes share field names but live in different
 * directions.
 *
 * Field policy:
 * - `kind` discriminates the source kind (decision, learning, entity,
 *   task, turn).
 * - `id` is the underlying aggregate id, kept as a string so the
 *   projection can carry every kind without a type parameter.
 * - `title` and `preview` are the two short renderable fields used by
 *   `RankedEntry` and `MemoryRef`.
 * - `tags`, `confidence`, `useCount`, `lastUsedAt`, `createdAt` carry
 *   the curator's bookkeeping signals so the hybrid scorer can compute
 *   recency / usage and the budgeter can rank by recency.
 * - `severity` is `null` unless `kind === "learning"`; the field is
 *   carried inline so the priority boost can map it to a multiplier.
 */
export interface MemoryProjection {
  readonly kind: QueryKindValue;
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly tags: Tags;
  readonly confidence: Confidence;
  readonly useCount: UseCount;
  readonly lastUsedAt: LastUsed;
  readonly createdAt: Timestamp;
  readonly severity: LearningSeverity | null;
}
