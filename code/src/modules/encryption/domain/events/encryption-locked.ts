import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: an `EncryptionConfig` was just re-locked, i.e. the master
 * key was discarded from process memory.
 *
 * Emitted by `EncryptionConfig.lock(...)`. Mirrors `EncryptionUnlocked`
 * in payload shape and security guarantees: nothing about the key
 * itself is included.
 *
 * Invariants:
 * - `workspaceId` identifies the encryption config's workspace.
 * - `occurredAt` is when the lock happened.
 * - `eventName` is the stable `"encryption.locked"` identifier.
 *
 * Note: there is no `keyId` field (in contrast to `EncryptionUnlocked`)
 * because the lock operation does not depend on which envelope
 * originally produced the in-memory key. Including it would also
 * couple the lock event to per-envelope state that becomes irrelevant
 * once the key is gone.
 */
export class EncryptionLocked implements DomainEvent {
  public readonly eventName = "encryption.locked" as const;
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
