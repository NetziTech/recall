/**
 * Wire-format types for the six MVP MCP tools, derived from
 * `docs/02-protocolo-mcp.md` §4. These DTOs represent the *exact* shape
 * exchanged on the JSON-RPC channel and live in `application/dtos/`
 * because that is where the contract between the protocol adapter and
 * the use cases is owned.
 *
 * Why these are plain types (not classes):
 * - DTOs are flat, immutable, serialisation-bound by definition (cf
 *   `docs/12-lineamientos-arquitectura.md` §1.2 table). They do not own
 *   invariants the way value objects or aggregates do; the Zod schemas
 *   in `infrastructure/validation/` are the validation choke-point.
 * - Keeping them as `type` aliases avoids forcing `infrastructure/`
 *   adapters to construct class instances they will only de-structure
 *   anyway.
 *
 * Wire-vs-domain mapping for `LayerName`:
 * - The retrieval module's `ContextLayerKind` uses domain-flavoured
 *   names (`workspace_anchor`, `active_decisions`, `entities_in_focus`,
 *   ...) while the wire protocol documented in `docs/02-protocolo-mcp.md`
 *   §4.2 uses transport-flavoured names (`system_identity`,
 *   `project_constitution`, `code_map`, ...). This module — being the
 *   protocol adapter — owns the wire literals. The translation between
 *   the two vocabularies is a composition-root concern: when the
 *   retrieval `GetContextFacade` adapter is wired, it emits wire
 *   literals on its way out. We do NOT import `ContextLayerKind` here
 *   to honour the strict modularity rule (`docs/12 §1.5`).
 *
 * Optionality:
 * - Optional fields use `?: T | undefined` to match the shape Zod's
 *   `.optional()` produces. With `exactOptionalPropertyTypes: true`,
 *   `?: T` would reject explicit `undefined` values; the union form
 *   accepts both "absent" and "explicitly-undefined" so the
 *   dispatcher can hand Zod's parsed output to the use case
 *   without an undefined-stripping pass. JSON serialisation drops
 *   `undefined` fields per `JSON.stringify` semantics, so the wire
 *   shape that reaches the client still has the absent fields
 *   simply absent.
 */

/**
 * Union of memory entry kinds documented in `docs/02-protocolo-mcp.md`
 * §4.3 (`mem.recall`) and §4.4 (`mem.remember`). The `"any"` literal
 * is only valid inside the `kinds` filter of `mem.recall`; the
 * remember/track flows reject it explicitly.
 */
export type MemoryKindWire =
  | "decision"
  | "learning"
  | "turn"
  | "entity"
  | "task";

export type RecallKindFilterWire = MemoryKindWire | "any";

/**
 * Wire literals for the seven context layers, exactly as
 * `docs/02-protocolo-mcp.md` §4.2 spells them out. Diverges from the
 * domain `ContextLayerKind` (see §6.5 D-102, HANDOFF.md) on three
 * names: `system_identity` (vs `workspace_anchor`),
 * `project_constitution` (vs `active_decisions`), `code_map` (vs
 * `entities_in_focus`). The composition-root facade adapter for
 * `GetContextFacade` translates between vocabularies.
 */
export type LayerNameWire =
  | "system_identity"
  | "project_constitution"
  | "active_tasks"
  | "recent_turns"
  | "relevant_memory"
  | "code_map"
  | "open_questions";

/**
 * Workspace mode literal shared by `mem.init` (input + output) and
 * `mem.health` (output). Mirrors the three-mode model of
 * `docs/11-seguridad-modos.md`.
 */
export type WorkspaceModeWire = "shared" | "encrypted" | "private";

/**
 * Encryption status literal. `"n/a"` is reserved for non-encrypted
 * workspaces so `mem.health` can carry the field unconditionally
 * (`docs/02-protocolo-mcp.md` §4.6).
 */
export type EncryptionStatusWire = "unlocked" | "locked" | "n/a";

/**
 * Task status / priority literals shared by `mem.task` and the
 * embedded `Task` type in its responses.
 */
export type TaskStatusWire = "pending" | "in_progress" | "done" | "blocked";
export type TaskStatusFilterWire = TaskStatusWire | "any";
export type TaskPriorityWire = "low" | "medium" | "high";

/**
 * Learning severity literal exposed by `mem.remember({kind:
 * "learning"})`.
 */
export type LearningSeverityWire = "tip" | "warning" | "critical";

/**
 * Entity kind literal exposed by `mem.remember({kind: "entity"})`.
 */
export type EntityKindWire =
  | "struct"
  | "module"
  | "service"
  | "agent"
  | "file";

/**
 * `order_by` literal accepted by `mem.recall`.
 */
export type RecallOrderByWire = "relevance" | "recency" | "score" | "usage";

/**
 * `scope` literal shared by `mem.recall` and `mem.remember`.
 */
export type ScopeWire = "project" | "module";

/**
 * `embedding_status` literal returned by `mem.remember`.
 */
export type EmbeddingStatusWire = "queued" | "ready" | "skipped";

/**
 * Health rating literal returned by `mem.health`.
 */
export type HealthRatingWire = "ok" | "rebuild_recommended" | "broken";

/**
 * `fallback_reason` literal returned by `mem.recall` when scoring had
 * to degrade (`docs/02-protocolo-mcp.md` §4.3).
 */
export type RecallFallbackReasonWire =
  | "no_embeddings_yet"
  | "embedder_unavailable";

// ─── mem.init ──────────────────────────────────────────────────────────

export interface InitInputWire {
  workspace_path?: string | undefined;
  mode?: WorkspaceModeWire | undefined;
  display_name?: string | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface InitOutputWire {
  workspace_id: string;
  workspace_path: string;
  display_name: string;
  mode: WorkspaceModeWire;
  is_new: boolean;
  total_entries: number;
  schema_version: string;
  encryption_status?: Exclude<EncryptionStatusWire, "n/a"> | undefined;
}

// ─── mem.context ───────────────────────────────────────────────────────

export interface ContextLayerWire {
  id: number;
  name: LayerNameWire;
  content: string;
  tokens: number;
  entries_count: number;
}

export interface ContextInputWire {
  workspace_id?: string | undefined;
  query?: string | undefined;
  max_tokens?: number | undefined;
  layer_overrides?: Readonly<Partial<Record<LayerNameWire, number>>> | undefined;
  include_layers?: readonly LayerNameWire[] | undefined;
  exclude_layers?: readonly LayerNameWire[] | undefined;
}

export interface ContextOutputWire {
  bundle: {
    layers: readonly ContextLayerWire[];
    total_tokens: number;
  };
}

// ─── mem.recall ────────────────────────────────────────────────────────

export interface MemoryEntryWire {
  id: string;
  kind: MemoryKindWire;
  content: string;
  metadata: Readonly<Record<string, unknown>>;
  score: number;
  created_at: number;
  last_used_ms: number;
  tags: readonly string[];
}

export interface RecallInputWire {
  workspace_id?: string | undefined;
  query?: string | undefined;
  kinds?: readonly RecallKindFilterWire[] | undefined;
  top_k?: number | undefined;
  max_tokens?: number | undefined;
  order_by?: RecallOrderByWire | undefined;
  since_ms?: number | undefined;
  must_have_tags?: readonly string[] | undefined;
  must_not_have_tags?: readonly string[] | undefined;
  scope?: ScopeWire | undefined;
  module?: string | undefined;
  include_superseded?: boolean | undefined;
}

export interface RecallOutputWire {
  results: readonly MemoryEntryWire[];
  total_candidates: number;
  total_tokens: number;
  fallback_reason?: RecallFallbackReasonWire | undefined;
}

// ─── mem.remember ──────────────────────────────────────────────────────

export interface EntityRelationWire {
  relation: string;
  target_name: string;
}

export interface RememberInputWire {
  workspace_id?: string | undefined;
  kind: MemoryKindWire;
  content: string;
  id?: string | undefined;
  tags?: readonly string[] | undefined;
  scope?: ScopeWire | undefined;
  module?: string | undefined;

  // decision-specific
  title?: string | undefined;
  rationale?: string | undefined;
  alternatives_rejected?: readonly string[] | undefined;
  superseded_by?: string | undefined;

  // learning-specific
  trigger?: string | undefined;
  severity?: LearningSeverityWire | undefined;

  // entity-specific
  name?: string | undefined;
  entity_kind?: EntityKindWire | undefined;
  location?: string | undefined;
  relations?: readonly EntityRelationWire[] | undefined;

  // turn-specific
  intent?: string | undefined;
  outcome?: string | undefined;
  files_touched?: readonly string[] | undefined;
  decisions_made?: readonly string[] | undefined;
  learnings_added?: readonly string[] | undefined;
}

export interface RememberOutputWire {
  id: string;
  kind: MemoryKindWire;
  upserted: boolean;
  similar_existing?: readonly string[] | undefined;
  embedding_status: EmbeddingStatusWire;
}

// ─── mem.task ──────────────────────────────────────────────────────────

export type TaskActionWire =
  | "create"
  | "update"
  | "list"
  | "get"
  | "delete";

export interface TaskNoteWire {
  at: number;
  text: string;
}

export interface TaskWire {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusWire;
  priority: TaskPriorityWire;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  blocked_by: readonly string[];
  notes: readonly TaskNoteWire[];
  tags: readonly string[];
}

export interface TaskListFilterWire {
  status?: TaskStatusFilterWire | undefined;
  tags?: readonly string[] | undefined;
  limit?: number | undefined;
}

export interface TaskInputWire {
  workspace_id?: string | undefined;
  action: TaskActionWire;

  // create
  title?: string | undefined;
  description?: string | undefined;
  priority?: TaskPriorityWire | undefined;
  blocked_by?: readonly string[] | undefined;
  tags?: readonly string[] | undefined;

  // update / get / delete
  task_id?: string | undefined;
  status?: TaskStatusWire | undefined;
  notes?: string | undefined;

  // list
  filter?: TaskListFilterWire | undefined;
}

/**
 * `mem.task` is polymorphic on `action`. Adapters return whichever
 * branch the action implies; the discriminated union keeps the wire
 * shape statically typed instead of resorting to `unknown`.
 */
export type TaskOutputWire =
  | { readonly action: "create"; readonly task_id: string; readonly updated_at: number }
  | { readonly action: "update"; readonly task_id: string; readonly updated_at: number }
  | { readonly action: "get"; readonly task: TaskWire }
  | { readonly action: "list"; readonly tasks: readonly TaskWire[] }
  | { readonly action: "delete"; readonly deleted: boolean };

// ─── mem.health ────────────────────────────────────────────────────────

export interface HealthInputWire {
  workspace_id?: string | undefined;
  verbose?: boolean | undefined;
}

export interface HealthSizeBytesWire {
  memoria_db: number;
  vectors_db: number;
}

export interface HealthActiveSessionWire {
  id: string;
  started_at: number;
}

export interface HealthOutputWire {
  schema_version: string;
  workspace_id: string;
  workspace_path: string;
  mode: WorkspaceModeWire;
  encryption_status: EncryptionStatusWire;

  total_entries: number;
  entries_by_kind: Readonly<Record<string, number>>;
  size_bytes: HealthSizeBytesWire;

  active_session: HealthActiveSessionWire | null;
  last_curator_run: number | null;
  embedding_model: string;
  embedding_queue_pending: number;

  fts_health: Exclude<HealthRatingWire, "broken">;
  vector_index_health: HealthRatingWire;

  warnings?: readonly string[] | undefined;
}
