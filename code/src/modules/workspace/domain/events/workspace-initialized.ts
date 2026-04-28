import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { WorkspaceMode } from "../value-objects/workspace-mode.ts";

/**
 * Fact: a workspace was just initialized in the host project.
 *
 * Emitted exactly once in the lifetime of a `Workspace` aggregate, by
 * `Workspace.initialize(...)`. Subscribers (audit log, telemetry,
 * `.gitignore` writer in the `private` mode flow) react to it after
 * successful persistence.
 *
 * Invariants:
 * - `workspaceId` is the freshly-minted id for the workspace.
 * - `mode` is the mode chosen at init time. Subsequent transitions emit
 *   `WorkspaceModeChanged` instead.
 * - `occurredAt` is the canonical creation instant (matches
 *   `config.json → created_at_ms` documented in
 *   `docs/03-modelo-datos.md` §2).
 * - `eventName` is the stable `"workspace.initialized"` identifier.
 */
export class WorkspaceInitialized implements DomainEvent {
  public readonly eventName = "workspace.initialized" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly mode: WorkspaceMode;

  public constructor(input: {
    workspaceId: WorkspaceId;
    mode: WorkspaceMode;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.mode = input.mode;
    this.occurredAt = input.occurredAt;
  }
}
