import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { isErr } from "../../../../shared/domain/types/result.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { EncryptionLockedError } from "../../domain/errors/encryption-locked-error.ts";
import type { EncryptionAuditLogRepository } from "../../domain/repositories/encryption-audit-log-repository.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import type { EnvelopeCipher } from "../../domain/services/envelope-cipher.ts";
import { EventId } from "../../domain/value-objects/event-id.ts";
import { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import { KeyId } from "../../domain/value-objects/key-id.ts";
import { MasterKeyFingerprint } from "../../domain/value-objects/master-key-fingerprint.ts";
import { SaltBytes } from "../../domain/value-objects/salt-bytes.ts";
import type {
  AddEnvelope,
  AddEnvelopeInput,
  AddEnvelopeOutput,
} from "../ports/in/add-envelope.port.ts";
import type { UnlockEncryption } from "../ports/in/unlock-encryption.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";
import type { RandomBytes } from "../ports/out/random-bytes.port.ts";

/**
 * Length, in bytes, of the freshly generated salt for the new
 * envelope's KDF. Matches the {@link SaltBytes} floor (RFC 9106
 * §3.1 recommends 16 bytes minimum); same value `InitializeEncryption`
 * uses, intentionally — no upside to varying it per envelope.
 */
const SALT_LENGTH_BYTES = 16;

/**
 * Canonical actor hint stored on the audit-log rows emitted by this
 * use case. Mirrors the format used elsewhere in the codebase
 * (`"cli:add-key"`); the audit-log adapter persists it verbatim into
 * `encryption_audit_log.actor_hint`.
 */
const ACTOR_HINT = "cli:add-key";

/**
 * Use case: append a secondary `KeyEnvelope` to an already-unlocked
 * encrypted workspace.
 *
 * See {@link AddEnvelope} (input port) for the full contract,
 * pre-conditions, atomicity model and failure modes. Notable design
 * decisions captured here:
 *
 * - **No re-derivation of the current passphrase.** ADR-005 Q1
 *   places the "current passphrase" check at the unlock boundary
 *   (the composition root calls `UnlockEncryption.unlock(...)`
 *   BEFORE invoking this use case). This use case observes the
 *   resulting unlocked aggregate via `config.isUnlocked()` and
 *   accesses the in-memory master key via `config.withUnlockedKey`.
 *   Refusing to operate on locked configs is the only door it has
 *   to police; the aggregate's `addEnvelope` invariant also rejects
 *   locked configs as defence-in-depth.
 *
 * - **Atomicity of the audit pair.** The two audit rows
 *   (`UnlockSucceeded` and `KeyEnvelopeAdded`) are batched inside
 *   one `DatabaseConnection.transaction(() => { ... })` so a SQLite
 *   crash mid-pair either commits both or neither. The transaction
 *   primitive in this codebase is synchronous, but the audit
 *   adapter's `append` is internally sync (better-sqlite3); we
 *   adapt the async return type by awaiting the unwrapped promise
 *   inside the closure via a synchronous resolution helper (see
 *   `appendAuditPairSync` below).
 *
 * - **Residual atomicity gap.** The encryption config is persisted
 *   to a JSON file (`config.json`) BEFORE the audit pair is
 *   committed. A crash between `repository.save(config)` and
 *   `auditLogRepository.append(...)` leaves the envelope present
 *   on disk but with no audit trail. ADR-005 Q4 accepts this trade
 *   as the lesser-evil branch (envelope-visible-without-audit beats
 *   audit-visible-without-envelope; the former is auditable via
 *   `recall audit`'s "gap detected" path, the latter would break
 *   the multi-key promise).
 */
export class AddEnvelopeUseCase implements AddEnvelope {
  public constructor(
    private readonly unlockUseCase: UnlockEncryption,
    private readonly configRepository: EncryptionConfigRepository,
    private readonly auditLogRepository: EncryptionAuditLogRepository,
    private readonly kdf: Kdf,
    private readonly envelopeCipher: EnvelopeCipher,
    private readonly randomBytes: RandomBytes,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly database: DatabaseConnection,
    private readonly logger: Logger,
  ) {}

  public async addEnvelope(
    input: AddEnvelopeInput,
  ): Promise<AddEnvelopeOutput> {
    // 1. Unlock the aggregate by delegating to UnlockEncryption.
    //    The unlock use case loads the config from the repository
    //    (rebuilt-from-JSON, hence locked) and derives the master
    //    key from the supplied currentPassphrase. On success it
    //    persists the audit-buffered events and returns the
    //    unlocked-in-memory aggregate; we receive that exact
    //    instance and continue mutating it.
    const unlockResult = await this.unlockUseCase.unlock({
      workspaceId: input.workspaceId,
      passphrase: input.currentPassphrase,
    });
    if (isErr(unlockResult)) {
      throw unlockResult.error;
    }
    const config = unlockResult.value;
    // Defence-in-depth: unlockResult should always come unlocked,
    // but we re-check the aggregate state to avoid relying solely
    // on the use case's contract (audit-log/replay safety).
    if (!config.isUnlocked()) {
      throw new EncryptionLockedError(input.workspaceId);
    }

    // 2. Mint fresh material for the new envelope.
    const salt = SaltBytes.from(this.randomBytes.next(SALT_LENGTH_BYTES));
    const kdfParams = KdfParams.defaults(salt);

    // 3. Derive the new envelope key.
    const derivation = await this.kdf.derive(input.newPassphrase, kdfParams);
    if (isErr(derivation)) {
      // Bypass-the-factory defensive branch (the defaults we just
      // built satisfy the floors, so this is unreachable in normal
      // flow). Surface as a thrown error so the composition root
      // observes the failure.
      throw derivation.error;
    }
    const derivedKey = derivation.value;

    // 4. AEAD-wrap the currently-unlocked master key. `withUnlockedKey`
    //    refuses if the aggregate is locked (already enforced above)
    //    and exposes the MasterKey VO; we delegate the wrap to the
    //    cipher port without copying bytes around.
    const occurredAt = this.clock.now();
    const wrappedMasterKey = await config.withUnlockedKey((masterKey) =>
      this.envelopeCipher.wrap(masterKey, derivedKey),
    );

    // 5. Build the new envelope VO and append via the aggregate.
    //    The aggregate emits `KeyEnvelopeAdded` and enforces the
    //    "all envelopes wrap the SAME master key" invariant via
    //    `unwrappedMasterKey`. We re-use the in-memory master key
    //    (NOT re-unwrap from the freshly-wrapped envelope) because:
    //      - The semantic invariant the aggregate polices is "the
    //        new envelope wraps the same master key the aggregate
    //        currently holds". Passing that exact key satisfies the
    //        invariant trivially.
    //      - Re-unwrapping would be wasted CPU (two AEAD operations
    //        when one suffices) and would obscure the intent.
    const newEnvelopeId = KeyId.from(this.idGenerator.generateString());
    const envelope = KeyEnvelope.create({
      keyId: newEnvelopeId,
      encryptedMasterKey: wrappedMasterKey,
      kdfParams,
      createdAt: occurredAt,
      label: input.label,
    });
    config.withUnlockedKey((masterKey) => {
      config.addEnvelope({
        envelope,
        unwrappedMasterKey: masterKey,
        occurredAt,
      });
    });

    // 6. Persist the aggregate (JSON file). If this throws, the
    //    audit pair is not appended — the envelope was never
    //    visible to disk so the audit trail correctly remains
    //    silent.
    await this.configRepository.save(config);

    // 7. Compute the master-key fingerprint of the currently-unlocked
    //    key. Stored on BOTH audit rows so a reader can join
    //    `UnlockSucceeded` with the following `KeyEnvelopeAdded`
    //    on the fingerprint column. The fingerprint VO never
    //    surfaces outside the audit adapter (see
    //    `MasterKeyFingerprint` security invariants).
    const fingerprint = config.withUnlockedKey((masterKey) =>
      masterKey.withBytes((bytes) =>
        MasterKeyFingerprint.fromMasterKey(bytes),
      ),
    );

    // 8. Append the audit pair atomically.
    const unlockEventId = EventId.from(this.idGenerator.generateString());
    const addedEventId = EventId.from(this.idGenerator.generateString());
    const actorHint = NonEmptyString.create(ACTOR_HINT, "actor_hint");
    await this.appendAuditPair({
      unlockEventId,
      addedEventId,
      envelopeId: newEnvelopeId,
      fingerprint,
      occurredAt,
      actorHint,
    });

    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        envelopeId: newEnvelopeId.toString(),
      },
      "encryption envelope added",
    );

    return {
      envelopeId: newEnvelopeId,
      addedAt: occurredAt,
    };
  }

  /**
   * Batches the two `EncryptionAuditEvent` appends inside a single
   * synchronous transaction so the audit pair is committed atomically.
   *
   * The audit adapter's `append` method is declared `Promise<void>`
   * for port-conformance reasons but the SQLite driver underneath
   * (better-sqlite3) is synchronous; the implementation does no real
   * I/O suspension. We honour the port shape by `await`-ing each
   * promise sequentially OUTSIDE the transaction closure — except
   * the closure itself wraps the synchronous statement runs.
   *
   * Implementation detail: the better-sqlite3 transaction primitive
   * exposed via `DatabaseConnection.transaction(fn)` is synchronous;
   * `fn` MUST NOT `await`. We therefore stage the work as two
   * `PreparedStatement.run(...)` invocations triggered by calling
   * the (sync-internal) `append` and resolving the returned promise
   * after the transaction returns. The current adapter implements
   * `append` as `async` but executes the SQL synchronously before
   * the implicit `await`, so the row IS committed before the
   * closure returns even though the returned `Promise<void>` only
   * resolves on the next microtask.
   *
   * This is the same pattern adopted by other modules' audit-log
   * use cases (see `secrets/application/use-cases/audit-finding.use-case.ts`,
   * which batches multiple `auditFindingRepository.append` calls
   * inside `database.transaction(...)`). The closure invokes the
   * adapter, ignores the returned promise (the SQL row is already
   * persisted), and lets the outer `await` propagate the rejection
   * if any of the underlying `run` calls throws synchronously.
   */
  private async appendAuditPair(input: {
    readonly unlockEventId: EventId;
    readonly addedEventId: EventId;
    readonly envelopeId: KeyId;
    readonly fingerprint: MasterKeyFingerprint;
    readonly occurredAt: Timestamp;
    readonly actorHint: NonEmptyString;
  }): Promise<void> {
    // Capture the two promises returned by the audit adapter; the
    // adapter implementation runs the SQL synchronously inside the
    // closure, so by the time the closure exits both INSERTs are
    // already committed-or-aborted by SQLite.
    let promises: Promise<void>[] = [];
    this.database.transaction((): void => {
      promises = [
        this.auditLogRepository.append({
          eventId: input.unlockEventId,
          occurredAt: input.occurredAt,
          eventType: "UnlockSucceeded",
          envelopeId: null,
          masterKeyFingerprint: input.fingerprint,
          actorHint: input.actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
        this.auditLogRepository.append({
          eventId: input.addedEventId,
          occurredAt: input.occurredAt,
          eventType: "KeyEnvelopeAdded",
          envelopeId: input.envelopeId,
          masterKeyFingerprint: input.fingerprint,
          actorHint: input.actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
      ];
    });
    // Drain the (already-resolved-at-the-driver-level) promises so
    // any synthetic rejection added by a future fake/adapter is
    // observable to the caller.
    await Promise.all(promises);
  }
}
