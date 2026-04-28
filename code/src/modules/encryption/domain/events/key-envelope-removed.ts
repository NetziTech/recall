import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { KeyId } from "../value-objects/key-id.ts";

/**
 * Fact: a `KeyEnvelope` was removed from an `EncryptionConfig`
 * aggregate.
 *
 * Emitted by `EncryptionConfig.removeEnvelope(...)` after the
 * "last envelope" invariant has been checked. Powers the rotation
 * flow documented in `docs/11-seguridad-modos.md` §7 ("Rotacion de
 * clave"): an operator first adds a new envelope, then removes
 * the obsolete one — the removal is what fires this event.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload MUST NOT include any byte of the wrapped master
 *   key, the derived key or the passphrase associated with the
 *   removed envelope. The envelope itself, by the time this event
 *   fires, has already been wiped from the aggregate.
 *
 * Invariants:
 * - `workspaceId` identifies the encryption config's workspace.
 * - `keyId` identifies the envelope that was removed.
 * - `occurredAt` is when the removal happened.
 * - `eventName` is the stable `"encryption.key-envelope-removed"`
 *   identifier.
 */
export class KeyEnvelopeRemoved implements DomainEvent {
  public readonly eventName = "encryption.key-envelope-removed" as const;
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
