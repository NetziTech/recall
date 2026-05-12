import type { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { EventId } from "../value-objects/event-id.ts";
import type { KeyId } from "../value-objects/key-id.ts";
import type { MasterKeyFingerprint } from "../value-objects/master-key-fingerprint.ts";

/**
 * Stable, exhaustive enumeration of the 12 event types that may be
 * appended to `encryption_audit_log`.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Frozen. New event types require a new ADR superseding ADR-005.
 *
 * Members:
 * - `KeyEnvelopeAdded`        : a passphrase envelope was added.
 * - `KeyEnvelopeRemoved`      : a passphrase envelope was removed.
 * - `RekeyStarted`            : a rotation of the master key began
 *                               (no `envelope_id` yet — the new
 *                               envelope is created during the flow).
 * - `RekeyCompleted`          : the rotation succeeded.
 * - `RekeyFailed`             : the rotation failed mid-flow.
 * - `UnlockSucceeded`         : a passphrase decrypted an envelope.
 * - `UnlockFailed`            : a passphrase did NOT decrypt any
 *                               envelope. The row's `envelope_id`
 *                               is `null` when the failure cannot
 *                               be attributed to a specific envelope.
 * - `ExportKeyEmitted`        : an export-key payload was generated.
 * - `KdfTimeoutExceeded`      : the KDF (argon2id) exceeded its
 *                               timeout budget.
 * - `RECOVERY_SKIP_CHECKSUM`  : an admin override skipped the
 *                               validator-blob check during recovery.
 * - `KeyValidatorMismatch`    : the validator blob decrypted but the
 *                               plaintext did NOT match the expected
 *                               sentinel.
 * - `LEGACY_KEY_UNLOCK`       : a unlock succeeded using a
 *                               grandfathered legacy key (pre-ADR-005).
 */
export type EncryptionAuditEventType =
  | "KeyEnvelopeAdded"
  | "KeyEnvelopeRemoved"
  | "RekeyStarted"
  | "RekeyCompleted"
  | "RekeyFailed"
  | "UnlockSucceeded"
  | "UnlockFailed"
  | "ExportKeyEmitted"
  | "KdfTimeoutExceeded"
  | "RECOVERY_SKIP_CHECKSUM"
  | "KeyValidatorMismatch"
  | "LEGACY_KEY_UNLOCK";

/**
 * Stable, exhaustive enumeration of the 3 outcomes that may be
 * recorded on an `EncryptionAuditEvent`.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Frozen.
 *
 * Members:
 * - `SUCCESS` : the event completed successfully.
 * - `FAILURE` : the event failed (any cause other than a timeout).
 * - `TIMEOUT` : the event failed because a deadline was exceeded.
 */
export type EncryptionAuditOutcome = "SUCCESS" | "FAILURE" | "TIMEOUT";

/**
 * Single immutable record describing one entry of the encryption
 * audit log.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Field semantics:
 * - `eventId`              : UUID v7 identity of this row.
 * - `occurredAt`           : moment the event happened. Stored as
 *                            `epoch_ms` in `occurred_at_ms`.
 * - `eventType`            : one of the 12 frozen strings (see
 *                            `EncryptionAuditEventType`).
 * - `envelopeId`           : id of the affected envelope, or `null`
 *                            when the event has no envelope (e.g.
 *                            `RekeyStarted`, `UnlockFailed` when no
 *                            envelope matched).
 * - `masterKeyFingerprint` : local-only fingerprint of the master
 *                            key in scope at the time of the event,
 *                            or `null` when no master key is in
 *                            scope (e.g. unlock failures, key
 *                            timeouts).
 * - `actorHint`            : human-readable origin, e.g.
 *                            `"cli:add-key"`, `"mcp:unlock"`.
 * - `outcome`              : `SUCCESS | FAILURE | TIMEOUT`.
 * - `detailJson`           : free-form metadata associated with the
 *                            event, e.g. `{ kdf_duration_ms: 245 }`.
 *                            **MUST NOT** contain secrets, passphrases,
 *                            derived keys, master keys, envelope
 *                            ciphertexts, AEAD tags or any other
 *                            cryptographic material. The application
 *                            layer enforces this invariant; the
 *                            persistence adapter trusts the field
 *                            already obeys the contract.
 *
 * Security invariants:
 * - The whole record is meant to be append-only at the persistence
 *   boundary; SQLite triggers in migration `009` reject any UPDATE
 *   or DELETE issued against `encryption_audit_log`.
 * - `masterKeyFingerprint` is local-only. The audit-log adapter is
 *   the only site allowed to serialise it. Other consumers MUST
 *   treat the field as opaque and MUST NOT log, return or transmit
 *   the value.
 */
export interface EncryptionAuditEvent {
  readonly eventId: EventId;
  readonly occurredAt: Timestamp;
  readonly eventType: EncryptionAuditEventType;
  readonly envelopeId: KeyId | null;
  readonly masterKeyFingerprint: MasterKeyFingerprint | null;
  readonly actorHint: NonEmptyString;
  readonly outcome: EncryptionAuditOutcome;
  readonly detailJson: Readonly<Record<string, unknown>> | null;
}

/**
 * Driven port (output port) for appending entries to the
 * `encryption_audit_log` table.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Contract:
 * - `append` is the **only** operation exposed by this port. The
 *   audit log is intentionally write-only at the domain boundary —
 *   nobody calls "read fingerprint" or "list events for envelope X"
 *   in the running system. Audit consumption happens out-of-band
 *   (operator running a `recall audit` command, or analysing a
 *   forensic copy of the database).
 * - The application layer guarantees `event.detailJson` is free of
 *   secrets BEFORE calling `append`. The adapter does NOT redact.
 * - Implementations MUST honour the append-only invariant: any
 *   future read methods MUST NOT return `masterKeyFingerprint`
 *   values to callers, only the redacted projection. JSDoc on any
 *   such method is mandatory and MUST repeat the constraint so the
 *   reviewer can refuse it during code review.
 * - Implementations MUST use prepared statements (docs/12 §1 perf).
 *
 * Why this port is in `domain/repositories/` and not
 * `application/ports/out/`:
 * - The encryption module follows the same convention as every
 *   other repository in the codebase (`memory/domain/repositories/*`,
 *   `secrets/domain/repositories/*`, `workspace/domain/repositories/*`,
 *   etc.): repository contracts live in domain because the
 *   aggregate's identity is defined there. Renaming them to
 *   `*.port.ts` and moving them to `application/ports/out/` would
 *   diverge from the codebase-wide pattern and trigger an architect
 *   rejection (per `docs/12 §1.5`).
 */
export interface EncryptionAuditLogRepository {
  /**
   * Appends one event to the `encryption_audit_log` table.
   *
   * Implementations MUST:
   * - Use a prepared statement (cached across calls).
   * - Persist exactly the fields documented on `EncryptionAuditEvent`.
   * - Encode `eventId` as a 16-byte UUID v7 BLOB (per the migration
   *   schema).
   * - Encode `occurredAt` as `epoch_ms`.
   * - Encode `detailJson` as a JSON string, or SQL NULL when the
   *   field is `null`.
   * - NOT mutate the input.
   *
   * @throws Implementation-specific error if the underlying database
   *         is unreachable or rejects the INSERT (e.g. duplicate
   *         `event_id` — UUID v7 collisions are practically
   *         impossible but the adapter still surfaces the SQL error).
   */
  append(event: EncryptionAuditEvent): Promise<void>;
}
