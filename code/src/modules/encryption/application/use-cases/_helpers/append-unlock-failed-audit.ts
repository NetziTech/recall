import type { DatabaseConnection } from "../../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import { NonEmptyString } from "../../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { EncryptionAuditLogRepository } from "../../../domain/repositories/encryption-audit-log-repository.ts";
import { EventId } from "../../../domain/value-objects/event-id.ts";

/**
 * Appends a single `UnlockFailed` row to `encryption_audit_log` when
 * `UnlockEncryption.unlock(...)` returns Err with a
 * `KeyValidationFailedError` during one of the multi-key flows
 * (`recall add-key` / `rekey` / `export-key`).
 *
 * Why a shared helper:
 * - The three use cases (`AddEnvelopeUseCase`, `RekeyEncryptionUseCase`,
 *   `ExportMasterKeyUseCase`) emit the same row shape with only the
 *   actor-hint varying. Inlining the implementation in each use case
 *   would duplicate ~30 lines of identical code and trip SonarQube's
 *   CPD threshold; extracting it here is the DRY-on-paper / DIP-clean
 *   compromise that the SOLID validator flagged as a future
 *   optimisation in the PR-F review.
 *
 * Row shape (constant across the three callers):
 * - `eventType` = `UnlockFailed`
 * - `envelopeId` = null (no envelope matched the supplied passphrase)
 * - `masterKeyFingerprint` = null (no master key reached scope)
 * - `outcome` = `FAILURE`
 * - `detailJson` = `{ reason }` — typically `"invalid-passphrase"`
 * - `actorHint` — caller-supplied (`cli:add-key` / `cli:rekey` /
 *   `cli:export-key`), wrapped in `NonEmptyString.create`
 *
 * Semantics:
 * - **Best-effort.** If the audit-log append itself throws, the helper
 *   swallows the error and logs a `warn` with the actor-hint. The
 *   caller observes a normal `Promise<void>` resolution and continues
 *   to its own `throw unlockResult.error` line. A broken audit
 *   infrastructure MUST NOT mask the user-facing wrong-passphrase
 *   signal.
 * - **Single SQLite transaction.** The append runs inside one
 *   `DatabaseConnection.transaction(...)` so a future fake/adapter
 *   that batches multiple INSERTs in the helper observes the same
 *   transactional envelope. Today there is exactly one INSERT but
 *   the transaction is preserved for forward compatibility.
 * - **Frozen invariants.** `envelopeId` + `masterKeyFingerprint` are
 *   forced to `null` here regardless of the caller's state. The
 *   helper does NOT accept a fingerprint parameter precisely because
 *   no master-key fingerprint is in scope when unlock fails (no
 *   envelope matched; the candidate master key was never validated).
 *
 * Failure isolation:
 * - The `logger.warn` payload contains only the auditError message
 *   string and the actor-hint. No passphrase bytes, derived keys,
 *   master keys, or workspace paths are interpolated.
 *
 * Closes follow-up tracked FP-A5-1 + F-A6-2 + FU-A7-1 (Phase-24 §6.29
 * security audits; HANDOFF §8).
 */
export async function appendUnlockFailedAudit(deps: {
  readonly auditLogRepository: EncryptionAuditLogRepository;
  readonly database: DatabaseConnection;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
  readonly occurredAt: Timestamp;
  readonly actorHint: string;
  readonly reason: string;
}): Promise<void> {
  const actorHintVo = NonEmptyString.create(deps.actorHint, "actor_hint");
  try {
    let promises: Promise<void>[] = [];
    deps.database.transaction((): void => {
      promises = [
        deps.auditLogRepository.append({
          eventId: EventId.from(deps.idGenerator.generateString()),
          occurredAt: deps.occurredAt,
          eventType: "UnlockFailed",
          envelopeId: null,
          masterKeyFingerprint: null,
          actorHint: actorHintVo,
          outcome: "FAILURE",
          detailJson: { reason: deps.reason },
        }),
      ];
    });
    await Promise.all(promises);
  } catch (auditError: unknown) {
    deps.logger.warn(
      {
        actorHint: deps.actorHint,
        auditError:
          auditError instanceof Error ? auditError.message : String(auditError),
      },
      "best-effort UnlockFailed audit append failed",
    );
  }
}
