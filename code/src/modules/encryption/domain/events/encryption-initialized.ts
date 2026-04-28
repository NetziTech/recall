import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { KdfAlgorithm } from "../value-objects/kdf-algorithm.ts";
import type { KeyId } from "../value-objects/key-id.ts";

/**
 * Fact: encryption was just initialized for a workspace.
 *
 * Emitted exactly once per `EncryptionConfig` aggregate, by
 * `EncryptionConfig.initialize(...)`. Subscribers (audit log,
 * telemetry, the unlock command flow that prints the key once on
 * stdout per `docs/11-seguridad-modos.md` §3) react to it after
 * successful persistence.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The payload MUST NOT include any byte of the master key, the
 *   derived key, the passphrase or the validator blob plaintext.
 *   Events are routinely serialized to logs and outbound subscribers;
 *   leaking key material here would be catastrophic.
 * - The KDF parameters themselves are NOT included either — they
 *   are not secret, but they are large and would clutter audit
 *   trails. Subscribers that need them can read the persisted
 *   `EncryptionConfig` separately.
 *
 * Invariants:
 * - `workspaceId` identifies the workspace the encryption belongs to.
 * - `kdfAlgorithm` records WHICH KDF was selected at init time.
 *   Stored as the algorithm VO (not the full spec) for the reasons
 *   described above.
 * - `firstKeyId` identifies the bootstrap envelope so audit logs
 *   can correlate later `KeyEnvelopeAdded` events with the
 *   original.
 * - `occurredAt` is the canonical creation instant.
 * - `eventName` is the stable `"encryption.initialized"` identifier.
 */
export class EncryptionInitialized implements DomainEvent {
  public readonly eventName = "encryption.initialized" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly kdfAlgorithm: KdfAlgorithm;
  public readonly firstKeyId: KeyId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    kdfAlgorithm: KdfAlgorithm;
    firstKeyId: KeyId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.kdfAlgorithm = input.kdfAlgorithm;
    this.firstKeyId = input.firstKeyId;
    this.occurredAt = input.occurredAt;
  }
}
