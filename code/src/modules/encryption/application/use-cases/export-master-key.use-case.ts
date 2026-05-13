import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { isErr } from "../../../../shared/domain/types/result.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { EncryptionConfig } from "../../domain/aggregates/encryption-config.ts";
import { EncryptionLockedError } from "../../domain/errors/encryption-locked-error.ts";
import { KeyValidationFailedError } from "../../domain/errors/key-validation-failed-error.ts";
import type { EncryptionAuditLogRepository } from "../../domain/repositories/encryption-audit-log-repository.ts";
import { EventId } from "../../domain/value-objects/event-id.ts";
import { MasterKeyFingerprint } from "../../domain/value-objects/master-key-fingerprint.ts";
import { PrintableMasterKey } from "../../domain/value-objects/printable-master-key.ts";
import type {
  ExportMasterKey,
  ExportMasterKeyInput,
  ExportMasterKeyOutput,
} from "../ports/in/export-master-key.port.ts";
import type { UnlockEncryption } from "../ports/in/unlock-encryption.port.ts";
import { appendUnlockFailedAudit } from "./_helpers/append-unlock-failed-audit.ts";

/**
 * Canonical actor hint stored on the audit-log row emitted by this
 * use case. Mirrors the format used elsewhere in the codebase
 * (`"cli:export-key"`); the audit-log adapter persists it verbatim
 * into `encryption_audit_log.actor_hint`.
 */
const ACTOR_HINT = "cli:export-key";

/**
 * Use case: re-render the master key of an already-existing encrypted
 * workspace as a `PrintableMasterKey` VO suitable for one-shot stdout
 * display.
 *
 * See {@link ExportMasterKey} (input port) for the full contract,
 * pre-conditions, atomicity model, the seven-step flow and the
 * documented limit ("export is read-only — no filesystem write").
 *
 * Notable design decisions captured here (and not on the port):
 *
 * - **Read-only constructor surface.** Unlike `AddEnvelopeUseCase`
 *   (A5) and `RekeyEncryptionUseCase` (A6) — which both rotate
 *   material and therefore depend on the KDF, cipher, random-bytes
 *   port and the config repository — `ExportMasterKeyUseCase` does
 *   NOT mutate the aggregate. The constructor surface is the
 *   minimum required to (a) unlock, (b) compute the fingerprint
 *   for the audit row, and (c) emit that row inside a SQLite
 *   transaction. The architect explicitly approved the asymmetry
 *   in ADR-005 Q3 (`docs/12 §1.5.5` appendix).
 *
 * - **No `repository.save`.** The aggregate is read-only over its
 *   lifetime inside this use case; the in-memory `PrintableMasterKey`
 *   VO is constructed from the unlocked master, then discarded by
 *   the consumer after stdout rendering. `config.json` is not
 *   touched on disk.
 *
 * - **Single audit row.** Unlike rekey (six rows) and add-key (two
 *   rows), export emits exactly ONE `ExportKeyEmitted` row. The
 *   atomicity story is correspondingly simpler — there is no
 *   FS-vs-SQL ordering gap to reason about because there is no FS
 *   write.
 *
 * - **`master_key_fp` containment.** The `MasterKeyFingerprint` VO
 *   is passed verbatim to the audit-log port (which converts to hex
 *   ONLY at the SQL adapter boundary). The fingerprint never
 *   surfaces in logs, in the wire output, or in exceptions. This
 *   matches the rekey / add-envelope conventions.
 *
 * - **Defensive unlock-check.** Step 2 of the flow re-checks
 *   `config.isUnlocked()` even though `UnlockEncryption.unlock(...)`
 *   guarantees the returned aggregate is unlocked. Failing loud on
 *   a contract violation avoids a silent invariant breach if a
 *   future refactor weakens the unlock contract.
 */
export class ExportMasterKeyUseCase implements ExportMasterKey {
  public constructor(
    private readonly unlockUseCase: UnlockEncryption,
    private readonly auditLogRepository: EncryptionAuditLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly database: DatabaseConnection,
    private readonly logger: Logger,
  ) {}

  public async exportMasterKey(
    input: ExportMasterKeyInput,
  ): Promise<ExportMasterKeyOutput> {
    // 1. Unlock the aggregate by delegating to UnlockEncryption.
    const unlockResult = await this.unlockUseCase.unlock({
      workspaceId: input.workspaceId,
      passphrase: input.currentPassphrase,
    });
    if (isErr(unlockResult)) {
      // FU-A7-1 (HANDOFF §8): emit a best-effort `UnlockFailed` audit
      // row BEFORE re-throwing when the failure is a wrong passphrase
      // (the brute-force signal we want to capture). The audit row is
      // NOT emitted for `EncryptionNotInitializedError`. The actor-hint
      // (`cli:export-key`) distinguishes export-failures from add-key
      // / rekey failures in the audit log.
      if (unlockResult.error instanceof KeyValidationFailedError) {
        await appendUnlockFailedAudit({
          auditLogRepository: this.auditLogRepository,
          database: this.database,
          idGenerator: this.idGenerator,
          logger: this.logger,
          occurredAt: this.clock.now(),
          actorHint: ACTOR_HINT,
          reason: "invalid-passphrase",
        });
      }
      throw unlockResult.error;
    }
    const config = unlockResult.value;
    // Defence-in-depth: refuse to proceed if the aggregate is still
    // locked (the unlock contract guarantees it isn't, but failing
    // loud avoids a silent invariant breach downstream).
    if (!config.isUnlocked()) {
      throw new EncryptionLockedError(input.workspaceId);
    }

    const occurredAt = this.clock.now();

    // 2. Render the master key (read-only over the aggregate). The
    //    VO defensively copies the bytes; the in-aggregate buffer is
    //    never aliased outside the closure.
    const printableMasterKey = this.renderPrintable(config);

    // 3. Compute the master-key fingerprint for the audit row. The
    //    VO is passed verbatim to the audit port — the SQL adapter
    //    is the only site allowed to call `.toHex()` (per the VO's
    //    security invariants).
    const fingerprint = this.computeFingerprint(config);

    // 4. Emit the single `ExportKeyEmitted` audit row atomically.
    await this.appendAuditRow({ fingerprint, occurredAt });

    this.logger.info(
      { workspaceId: input.workspaceId.toString() },
      "encryption export-key completed",
    );

    return { printableMasterKey, exportedAt: occurredAt };
  }

  // -- private helpers -----------------------------------------------------

  /**
   * Builds a `PrintableMasterKey` VO from the currently-unlocked
   * master key. The double `withUnlockedKey` / `withBytes` nesting
   * keeps the secret bytes inside the audited disclosure surface
   * (the VO never observes them as an externally-held alias).
   */
  private renderPrintable(config: EncryptionConfig): PrintableMasterKey {
    return config.withUnlockedKey((masterKey) =>
      masterKey.withBytes((bytes) => PrintableMasterKey.fromMasterKey(bytes)),
    );
  }

  /**
   * Computes the truncated master-key fingerprint of the
   * currently-unlocked key. Stored on the single audit row so a
   * forensic reader can correlate `ExportKeyEmitted` with earlier
   * `UnlockSucceeded` / `KeyEnvelopeAdded` rows on the same key
   * material.
   */
  private computeFingerprint(config: EncryptionConfig): MasterKeyFingerprint {
    return config.withUnlockedKey((masterKey) =>
      masterKey.withBytes((bytes) => MasterKeyFingerprint.fromMasterKey(bytes)),
    );
  }

  /**
   * Appends the single `ExportKeyEmitted` audit row inside one
   * `DatabaseConnection.transaction(...)` so the row is atomically
   * committed or aborted. Mirrors the audit-batch helpers in A5 / A6:
   * the SQLite driver underneath (better-sqlite3) is synchronous,
   * but the port shape is async, so we collect the returned promise
   * inside the synchronous closure and `await` it outside.
   */
  private async appendAuditRow(input: {
    readonly fingerprint: MasterKeyFingerprint;
    readonly occurredAt: Timestamp;
  }): Promise<void> {
    const actorHint = NonEmptyString.create(ACTOR_HINT, "actor_hint");
    let promises: Promise<void>[] = [];
    this.database.transaction((): void => {
      promises = [
        this.auditLogRepository.append({
          eventId: EventId.from(this.idGenerator.generateString()),
          occurredAt: input.occurredAt,
          eventType: "ExportKeyEmitted",
          envelopeId: null,
          masterKeyFingerprint: input.fingerprint,
          actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
      ];
    });
    await Promise.all(promises);
  }

}
