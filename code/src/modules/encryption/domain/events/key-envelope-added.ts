import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { KeyId } from "../value-objects/key-id.ts";
import type { KeyLabel } from "../value-objects/key-label.ts";

/**
 * Fact: a new `KeyEnvelope` was added to an `EncryptionConfig`
 * aggregate.
 *
 * Emitted by `EncryptionConfig.addEnvelope(...)` after the master
 * key match has been verified. Powers the multi-key flow described
 * in `docs/11-seguridad-modos.md` §7 ("Cada miembro del equipo con
 * su propia clave").
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload MUST NOT include any byte of the wrapped or
 *   unwrapped master key, the derived key, the passphrase, or the
 *   envelope ciphertext / IV / tag. Subscribers that need the full
 *   envelope can read the persisted aggregate; the event is just
 *   the trigger.
 * - The optional `label` is included because it is by design a
 *   human-readable description (no secret content, see
 *   `KeyLabel`).
 *
 * Invariants:
 * - `workspaceId` identifies the encryption config's workspace.
 * - `keyId` identifies the freshly added envelope.
 * - `label` is the optional human-readable description, or `null`
 *   if the envelope was added without one.
 * - `occurredAt` is when the addition happened.
 * - `eventName` is the stable `"encryption.key-envelope-added"`
 *   identifier.
 */
export class KeyEnvelopeAdded implements DomainEvent {
  public readonly eventName = "encryption.key-envelope-added" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly keyId: KeyId;
  public readonly label: KeyLabel | null;

  public constructor(input: {
    workspaceId: WorkspaceId;
    keyId: KeyId;
    label: KeyLabel | null;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.keyId = input.keyId;
    this.label = input.label;
    this.occurredAt = input.occurredAt;
  }
}
