import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: a candidate `MasterKey` failed to validate against the
 * workspace's `KeyValidatorBlob`.
 *
 * Emitted by `EncryptionConfig.unlockWith(...)` BEFORE raising
 * `KeyValidationFailedError`. Power users hook into this event to
 * implement rate-limiting on unlock attempts (a brute-force attack
 * looks like a flood of these events) or to surface a notification
 * when a CI job's cached key has been revoked.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload is intentionally MINIMAL. It includes only the
 *   `workspaceId` (already public) and the `occurredAt` timestamp.
 * - It does NOT include:
 *     - the candidate key bytes,
 *     - the passphrase,
 *     - the derived key,
 *     - the key id of any envelope (we do not even know which
 *       envelope was being targeted; the unlock attempt is against
 *       the validator blob, not against a specific envelope),
 *     - the originating IP / user (the domain has no notion of
 *       transport identity).
 * - Each of those would either leak secret material or invite the
 *   subscriber to make security decisions on data the domain does
 *   not authoritatively own.
 *
 * Invariants:
 * - `workspaceId` identifies the encryption config's workspace.
 * - `occurredAt` is when the validation attempt happened.
 * - `eventName` is the stable `"encryption.key-validation-failed"`
 *   identifier.
 */
export class KeyValidationFailed implements DomainEvent {
  public readonly eventName = "encryption.key-validation-failed" as const;
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
