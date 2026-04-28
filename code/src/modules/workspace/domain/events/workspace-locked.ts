import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: an encrypted workspace was deliberately re-locked.
 *
 * Triggered by the `recall forget-key` flow described in
 * `docs/11-seguridad-modos.md` §3 (commands list). Subscribers wipe the
 * key from `~/.config/recall/keys/...` and any in-process key
 * cache.
 *
 * Invariants:
 * - Only emitted on workspaces whose mode is `encrypted` and that were
 *   previously unlocked. The aggregate refuses other transitions.
 * - `eventName` is the stable `"workspace.locked"` identifier.
 */
export class WorkspaceLocked implements DomainEvent {
  public readonly eventName = "workspace.locked" as const;
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
