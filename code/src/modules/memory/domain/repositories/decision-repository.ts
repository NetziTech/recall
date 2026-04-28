import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Decision } from "../aggregates/decision.ts";
import type { DecisionId } from "../value-objects/decision-id.ts";
import type { DecisionStatus } from "../value-objects/decision-status.ts";

/**
 * Driven port (output port) for persisting and reloading the
 * `Decision` aggregate.
 *
 * Implementations live in `infrastructure/persistence/` and translate
 * between the in-memory aggregate and the `decisions` table documented
 * in `docs/03-modelo-datos.md` §4.3.
 *
 * Contract:
 * - Methods work with the **whole aggregate**. Adapters MUST NOT
 *   expose partial-update methods or expose internal fields.
 * - `findById` returns `null` (not a thrown error) when the decision
 *   does not exist.
 * - `save` is responsible for persisting the aggregate atomically;
 *   per-row partial writes are a contract violation.
 * - Events buffered in the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after `save` succeeds.
 *
 * Query methods are named after business intent rather than SQL
 * predicates so the application layer cannot drift into ad-hoc
 * filtering.
 */
export interface DecisionRepository {
  /**
   * Loads the decision identified by `id` from persistence. Returns
   * `null` if it does not exist.
   */
  findById(id: DecisionId): Promise<Decision | null>;

  /**
   * Persists the decision. Implementations are free to perform an
   * upsert (the aggregate carries its own identity) but MUST be
   * atomic.
   */
  save(decision: Decision): Promise<void>;

  /**
   * Returns every decision in `workspaceId`, optionally filtered by
   * `status`. When `status` is omitted, BOTH active and superseded
   * decisions are returned (the application layer is responsible for
   * deciding whether to surface superseded entries — recall defaults
   * to hiding them, see `docs/02-protocolo-mcp.md` §4.3
   * `include_superseded: false`).
   */
  findByWorkspace(
    workspaceId: WorkspaceId,
    status?: DecisionStatus,
  ): Promise<readonly Decision[]>;

  /**
   * Returns every active decision in `workspaceId` whose tag set
   * contains every tag in `requiredTags` (`mem.recall.must_have_tags`,
   * `docs/02-protocolo-mcp.md` §4.3). Implementations that read from
   * the FTS layer are free to push the filtering down to SQL.
   */
  findActiveByTags(
    workspaceId: WorkspaceId,
    requiredTags: Tags,
  ): Promise<readonly Decision[]>;
}
