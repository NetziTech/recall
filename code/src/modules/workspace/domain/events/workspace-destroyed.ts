import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: an entire workspace (SQL tables + on-disk directory tree)
 * was deliberately destroyed by the operator via `mcp-memoria wipe`.
 *
 * Triggered by `DestroyWorkspaceUseCase`. Subscribers can use this
 * event to:
 *   - Drop in-process caches keyed by the workspace id.
 *   - Audit-log the destruction with the timestamp.
 *   - Tear down any monitoring hooks tied to the workspace.
 *
 * Invariants:
 * - The event is emitted AFTER both the SQL truncation and the
 *   filesystem removal have completed successfully. A use-case
 *   failure mid-flow does NOT emit the event (the buffered events
 *   are not pulled).
 * - `eventName` is the stable `"workspace.destroyed"` identifier.
 */
export class WorkspaceDestroyed implements DomainEvent {
  public readonly eventName = "workspace.destroyed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  /** Absolute path of the directory tree that was removed. */
  public readonly removedPath: string;

  public constructor(input: {
    workspaceId: WorkspaceId;
    removedPath: string;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.removedPath = input.removedPath;
    this.occurredAt = input.occurredAt;
  }
}
