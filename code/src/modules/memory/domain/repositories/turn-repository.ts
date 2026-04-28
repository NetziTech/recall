import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Turn } from "../aggregates/turn.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { TurnId } from "../value-objects/turn-id.ts";

/**
 * Driven port for persisting and reloading the `Turn` aggregate.
 *
 * Mirrors the `turns` table contract from `docs/03-modelo-datos.md`
 * §4.2. Turns are append-only history; the repository exposes only
 * read and insert operations.
 *
 * Contract:
 * - `findById` returns `null` on miss.
 * - `save` is atomic and is expected to fail on duplicate-id inserts
 *   (turns are immutable; the application layer should never call
 *   `save` twice on the same turn).
 */
export interface TurnRepository {
  findById(id: TurnId): Promise<Turn | null>;

  save(turn: Turn): Promise<void>;

  /**
   * Returns the most recent `limit` turns recorded in `sessionId`,
   * ordered most-recent-first. Powers Capa 4 of the context bundle
   * (`docs/04-capas-contexto.md` §3.4 — Recent Turns).
   *
   * `limit` must be a positive integer. The implementation MUST
   * respect it strictly (no over-fetching).
   */
  findBySession(
    sessionId: SessionId,
    limit: number,
  ): Promise<readonly Turn[]>;

  /**
   * Returns EVERY turn in `workspaceId`, ordered most-recent-first
   * (recorded_at_ms DESC, id DESC).
   *
   * Powers `MemorySnapshotReader` (used by `ExportMemoryUseCase`).
   * Implementations MUST resolve the full set in a single SQL query
   * (no N+1 walk by id) so the export use case can meet its 50K rows
   * < 30 s nightly target. Adapters that pin a `WorkspaceId` at
   * construction time MUST validate the argument matches.
   */
  findAllByWorkspace(workspaceId: WorkspaceId): Promise<readonly Turn[]>;
}
