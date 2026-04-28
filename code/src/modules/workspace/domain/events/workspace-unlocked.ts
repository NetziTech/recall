import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: an encrypted workspace was successfully unlocked in the current
 * process.
 *
 * The actual key derivation, validation and persistence in
 * `~/.config/recall/keys/<workspace_id>.key` are infrastructure
 * concerns (see `docs/11-seguridad-modos.md` §3 and §7). The aggregate
 * only records the *fact* that the unlock happened, so audit logs and
 * downstream readiness signals can react.
 *
 * Invariants:
 * - Only emitted when the prior state was `encrypted + locked`. The
 *   aggregate refuses to emit it for non-encrypted workspaces.
 * - `eventName` is the stable `"workspace.unlocked"` identifier.
 */
export class WorkspaceUnlocked implements DomainEvent {
  public readonly eventName = "workspace.unlocked" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.occurredAt = input.occurredAt;
  }
}
