import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { KeyId } from "../value-objects/key-id.ts";

/**
 * Fact: an `EncryptionConfig` was just unlocked, i.e. the master
 * key was successfully decoded and is now held in memory by the
 * aggregate.
 *
 * Emitted by `EncryptionConfig.unlockWith(...)` after the
 * `KeyValidatorBlob` has accepted the candidate master key.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload MUST NOT include the master key bytes, the
 *   passphrase, or the derived key that produced it. Audit trails
 *   only need the workspace id, the envelope id that was used (so
 *   operators can detect "wrong member's key was used") and the
 *   timestamp.
 *
 * Invariants:
 * - `workspaceId` identifies the encryption config's workspace.
 * - `keyId` identifies the envelope that supplied the master key
 *   (so audit logs can show "alice@laptop unlocked at 12:34").
 * - `occurredAt` is when the unlock happened.
 * - `eventName` is the stable `"encryption.unlocked"` identifier.
 */
export class EncryptionUnlocked implements DomainEvent {
  public readonly eventName = "encryption.unlocked" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly keyId: KeyId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    keyId: KeyId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.keyId = input.keyId;
    this.occurredAt = input.occurredAt;
  }
}
