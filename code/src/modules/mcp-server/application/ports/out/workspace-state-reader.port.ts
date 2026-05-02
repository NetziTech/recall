import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Live snapshot of the workspace's runtime state, as needed by the
 * `mem.health` tool's response. The fields are primitives only — the
 * port intentionally avoids domain VOs from other modules so the
 * cross-module read can be implemented at the composition layer
 * without leaking domain types across module boundaries (ADR-001).
 *
 * Field semantics:
 *   - `mode`: the persisted workspace mode (mirrors `workspace_config.mode`).
 *   - `encryptionStatus`: best-effort. For non-encrypted modes this is
 *     always `"n/a"`. For `encrypted` mode the reader returns
 *     `"locked"` by default; runtime unlock state is not currently
 *     surfaced through this port — the bootstrap holds the unlocked
 *     key in a closure that the facade has no handle on. Tracked
 *     explicitly: a future iteration will inject the runtime
 *     unlock-state probe.
 *   - `entriesByKind`: raw `COUNT(*)` per memory table, scoped to the
 *     workspace. Keys are the wire kinds (`decision`, `learning`,
 *     `entity`, `turn`, `task`).
 *   - `totalEntries`: sum of the per-kind counts. Returned alongside
 *     `entriesByKind` so the caller does not need to recompute.
 *   - `sizeBytes.recallDb`: filesystem size of the main `recall.db`
 *     file plus its WAL/SHM siblings (if present). The vec0 virtual
 *     table lives inside `recall.db`, so there is no separate
 *     vectors database file; this value reflects the full storage
 *     footprint.
 *   - `sizeBytes.vectorsDb`: kept as `0` for back-compat with the
 *     legacy wire field name (`size_bytes.vectors_db`). The wire
 *     facade preserves both names; this field is structural rather
 *     than semantic. Tracked as wire-schema debt with `memoria_db`.
 *   - `activeSession`: the most recent session row whose
 *     `ended_at_ms IS NULL`. `null` when the workspace has no open
 *     session.
 *   - `lastCuratorRunAtMs`: `started_at_ms` of the most recent
 *     `curator_runs` row, or `null` when the curator has never run.
 *   - `embeddingQueuePending`: `COUNT(*)` over `embedding_queue` for
 *     the workspace. Drops to zero once the embedding worker drains
 *     the queue (Bug B-MCP-3, fixed in v0.1.2-beta.1).
 */
export interface WorkspaceStateSnapshot {
  readonly mode: "shared" | "encrypted" | "private";
  readonly encryptionStatus: "unlocked" | "locked" | "n/a";
  readonly entriesByKind: Readonly<Record<string, number>>;
  readonly totalEntries: number;
  readonly sizeBytes: {
    readonly recallDb: number;
    readonly vectorsDb: number;
  };
  readonly activeSession: {
    readonly id: string;
    readonly startedAtMs: number;
  } | null;
  readonly lastCuratorRunAtMs: number | null;
  readonly embeddingQueuePending: number;
}

/**
 * Outbound port consumed by `CheckHealthFacadeAdapter` to obtain the
 * real diagnostic state of the workspace. The adapter implementing
 * this port is the only place in the codebase allowed to read across
 * module boundaries (decisions / learnings / entities / turns / tasks
 * / sessions / curator_runs / embedding_queue / workspace_config) so
 * the cross-module SQL stays scoped to the composition layer.
 *
 * Failure semantics:
 *   - The adapter SHOULD swallow per-query failures and return safe
 *     defaults (e.g. `0` for missing counts, `null` for missing
 *     latest-row reads). `mem.health` is a diagnostic tool; it must
 *     never fail loudly when a partial answer is informative.
 *   - The adapter MUST throw when the database connection itself is
 *     unusable so the caller can map the error to a JSON-RPC failure
 *     instead of returning misleading zeros.
 */
export interface WorkspaceStateReader {
  readState(input: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceRoot: string;
  }): Promise<WorkspaceStateSnapshot>;
}
