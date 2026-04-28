import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Session } from "../aggregates/session.ts";
import type { SessionId } from "../value-objects/session-id.ts";

/**
 * Driven port for persisting and reloading the `Session` aggregate.
 *
 * Mirrors the `sessions` table contract from
 * `docs/03-modelo-datos.md` §4.1.
 *
 * Contract:
 * - `findById` returns `null` on miss.
 * - `save` is atomic.
 */
export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;

  save(session: Session): Promise<void>;

  /**
   * Returns the active session for `workspaceId` if one exists.
   *
   * "Active" is defined as the most recent session where
   * `endedAt === null`. There is at most one such session per
   * workspace by the implicit-session model
   * (`docs/01-arquitectura.md` §2.5): when the runtime detects idle
   * timeout it ends the previous session before starting a new one.
   * The repository returns `null` when no open session exists (the
   * application layer is then expected to call `Session.start(...)`).
   */
  findCurrentByWorkspace(workspaceId: WorkspaceId): Promise<Session | null>;

  /**
   * Returns EVERY session in `workspaceId`, ordered most-recent-first
   * (started_at_ms DESC, id DESC).
   *
   * Powers `MemorySnapshotReader` (used by `ExportMemoryUseCase`).
   * Implementations MUST resolve the full set in a single SQL query
   * (no N+1 walk by id). Adapters that pin a `WorkspaceId` at
   * construction time MUST validate the argument matches.
   */
  findAllByWorkspace(workspaceId: WorkspaceId): Promise<readonly Session[]>;
}
