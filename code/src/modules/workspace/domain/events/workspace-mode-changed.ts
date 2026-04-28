import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { WorkspaceMode } from "../value-objects/workspace-mode.ts";

/**
 * Fact: the privacy mode of a workspace was changed.
 *
 * Emitted by `Workspace.changeMode(...)` after the transition has been
 * validated against the mode state machine
 * (see `docs/11-seguridad-modos.md` §5). The handler downstream is the
 * one that re-cifrates / decifrates DBs, rewrites `.gitignore`, etc.,
 * but those side effects belong to the application layer; the event is
 * the trigger.
 *
 * Invariants:
 * - `previousMode` and `newMode` are different (the aggregate never
 *   emits a no-op transition).
 * - `eventName` is the stable `"workspace.mode-changed"` identifier.
 */
export class WorkspaceModeChanged implements DomainEvent {
  public readonly eventName = "workspace.mode-changed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly previousMode: WorkspaceMode;
  public readonly newMode: WorkspaceMode;

  public constructor(input: {
    workspaceId: WorkspaceId;
    previousMode: WorkspaceMode;
    newMode: WorkspaceMode;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.previousMode = input.previousMode;
    this.newMode = input.newMode;
    this.occurredAt = input.occurredAt;
  }
}
