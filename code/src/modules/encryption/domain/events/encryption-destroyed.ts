import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Fact: the `EncryptionConfig` for a workspace was just destroyed —
 * i.e. the persisted slice (`kdf`, `kdf_params`,
 * `key_validator_blob_b64`, `key_envelopes`) was removed from
 * `config.json` and the in-memory aggregate is no longer the source
 * of truth for the workspace.
 *
 * Emitted by the `DestroyEncryptionUseCase` after successful
 * persistence of the empty slice. The use case is the canonical
 * crypto half of the workspace's `encrypted -> private` mode
 * transition documented in `docs/11-seguridad-modos.md` §5; the
 * second half (re-keying / decrypting the SQLCipher database into a
 * plain SQLite file) is the responsibility of the workspace module
 * and is NOT signalled by this event.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload MUST NOT include any byte of the (now-discarded)
 *   master key, the derived key, the passphrase, or the validator
 *   blob plaintext. Events are routinely serialised to logs and
 *   outbound subscribers; leaking former key material would be
 *   catastrophic even though the workspace is leaving encrypted
 *   mode.
 *
 * Invariants:
 * - `workspaceId` identifies the workspace whose encryption was
 *   destroyed.
 * - `occurredAt` is the canonical destruction instant.
 * - `eventName` is the stable `"encryption.destroyed"` identifier.
 *
 * Note on past-tense naming:
 * - The convention adopted by `docs/12 §3.1` and validated by
 *   `ddd-validator` in Tarea 3.2 prescribes
 *   `<module>.<event-name-in-past-tense-kebab-case>`. "destroyed"
 *   matches that pattern; the event represents a fact that has
 *   already happened and persisted.
 */
export class EncryptionDestroyed implements DomainEvent {
  public readonly eventName = "encryption.destroyed" as const;
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
