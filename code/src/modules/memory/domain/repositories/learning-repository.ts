import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Learning } from "../aggregates/learning.ts";
import type { LearningId } from "../value-objects/learning-id.ts";
import type { LearningSeverity } from "../value-objects/learning-severity.ts";

/**
 * Driven port for persisting and reloading the `Learning` aggregate.
 *
 * Mirrors the `learnings` table contract from
 * `docs/03-modelo-datos.md` §4.4. Active learnings are those with
 * `consolidatedInto === null`; the curator's consolidation pass folds
 * duplicates into a canonical entry without deleting the original.
 *
 * Contract:
 * - `findById` returns `null` when the learning does not exist.
 * - `save` is atomic.
 * - Domain events buffered on the aggregate are NOT consumed here.
 */
export interface LearningRepository {
  findById(id: LearningId): Promise<Learning | null>;

  save(learning: Learning): Promise<void>;

  /**
   * Returns every learning in `workspaceId` (active and consolidated
   * alike). The application layer filters by `consolidatedInto` when
   * it needs the active subset.
   */
  findByWorkspace(workspaceId: WorkspaceId): Promise<readonly Learning[]>;

  /**
   * Returns every active learning in `workspaceId` whose severity is
   * at least as severe as `minimumSeverity`. Used by recall to
   * surface critical items first (`docs/03-modelo-datos.md` §4.4 —
   * "Severity afecta decay").
   */
  findActiveByMinimumSeverity(
    workspaceId: WorkspaceId,
    minimumSeverity: LearningSeverity,
  ): Promise<readonly Learning[]>;
}
