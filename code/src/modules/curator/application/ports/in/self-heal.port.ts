import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../../../domain/value-objects/curator-run-id.ts";

/**
 * Outcome of one `SelfHeal` invocation.
 *
 * The counters mirror the four self-healing checks documented in
 * `docs/05-memoria-decay.md` §5 (Caso 1 — paths, Caso 2 — decision
 * conflicts, Caso 5 — embedding queue, Caso 3 — open question aging).
 * Caso 4 ("re-retrieval cuando recall vacio") is NOT a curator
 * concern; it lives on the recall path and never enters this use
 * case.
 *
 * `findingsRecorded` is the total number of findings emitted across
 * the four checks (sum of the per-bucket counters); the orchestrator
 * uses it to bump `CuratorRunStats.with(...)` and to surface a single
 * progress number in the `mem.curator_run` response.
 */
export interface SelfHealResult {
  readonly runId: CuratorRunId;
  readonly pathsCorrected: number;
  readonly decisionConflictsDetected: number;
  readonly embeddingsRequeued: number;
  readonly openQuestionsAged: number;
  readonly findingsRecorded: number;
}

/**
 * Driving (input) port: run the curator's four self-healing checks.
 *
 * Mirrors steps (#4 — paths, #5 — conflicts, #6 — embedding queue) of
 * the curator pass documented in `docs/05-memoria-decay.md` §6
 * ("Pasada completa") plus the open-question aging check in §5 Caso 3.
 *
 * The four checks:
 *
 * 1. **Path stale (Caso 1).** For every `Entity` with a non-null
 *    location, asks the `FilesystemChecker` driven port whether the
 *    target file or directory still exists. When it doesn't, halves
 *    the entity's `confidence`, tags it with `stale`, and records a
 *    `path_stale` finding on the active `CuratorRun`.
 *
 * 2. **Decision conflict (Caso 2).** For every active `Decision`,
 *    pairs it against other active decisions sharing the same
 *    `(scope, module)`. The cosine-similarity heuristic flags
 *    candidates and records a `decision_conflict` finding. The
 *    curator does NOT auto-resolve; the user does.
 *
 * 3. **Embedding drift (Caso 5).** For every entry whose
 *    `embedding_queue` row exhausted its retries (`attempts >= 5`)
 *    or whose vector dimension differs from the active embedder's
 *    dimension, records an `embedding_drift` finding. The use case
 *    does NOT re-enqueue — that responsibility belongs to the
 *    retrieval module's worker. The use case only counts how many
 *    drifts the run observed (`embeddingsRequeued` in the result is
 *    a misnomer kept for spec parity; reads as "how many drifts").
 *
 * 4. **Open question aging (Caso 3).** For every `Session.metadata.openQuestion`
 *    older than three sessions, tags it `aging` and records an
 *    `open_question_aging` finding. The actual recall promotion is
 *    handled by Capa 7 of the context bundle.
 *
 * Idempotency:
 * - All four checks are idempotent within a single `runId`: re-running
 *   them produces the same set of findings (the underlying state has
 *   not changed between invocations within the same pass).
 *
 * Performance:
 * - Caso 1 is O(N entities). Caso 2 is O(D²) but bounded by
 *   `(scope, module)` pre-grouping — the `Decision` count per group
 *   is small in practice. Caso 3 is O(open questions). Caso 5 is O(N
 *   queue rows).
 */
export interface SelfHeal {
  heal(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
  }): Promise<SelfHealResult>;
}
