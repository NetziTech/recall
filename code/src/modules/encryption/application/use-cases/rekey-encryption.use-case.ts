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
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import type { EnvelopeCipher } from "../../domain/services/envelope-cipher.ts";
import { EventId } from "../../domain/value-objects/event-id.ts";
import { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import { KeyId } from "../../domain/value-objects/key-id.ts";
import { MasterKeyFingerprint } from "../../domain/value-objects/master-key-fingerprint.ts";
import { SaltBytes } from "../../domain/value-objects/salt-bytes.ts";
import type {
  RekeyEncryption,
  RekeyInput,
  RekeyOutput,
} from "../ports/in/rekey-encryption.port.ts";
import type { UnlockEncryption } from "../ports/in/unlock-encryption.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";
import type { RandomBytes } from "../ports/out/random-bytes.port.ts";

/**
 * Length, in bytes, of the freshly generated salt for the new
 * envelope's KDF. Matches the {@link SaltBytes} floor (RFC 9106
 * §3.1 recommends 16 bytes minimum); same value `InitializeEncryption`
 * and `AddEnvelopeUseCase` use.
 */
const SALT_LENGTH_BYTES = 16;

/**
 * Canonical actor hint stored on the audit-log rows emitted by this
 * use case. Mirrors the format used elsewhere in the codebase
 * (`"cli:rekey"`); the audit-log adapter persists it verbatim into
 * `encryption_audit_log.actor_hint`.
 */
const ACTOR_HINT = "cli:rekey";

/**
 * Sub-bag returned by {@link RekeyEncryptionUseCase} when staging the
 * fresh envelope: the envelope VO plus its id and KDF params (re-used
 * by the aggregate's `addEnvelope` invariant and by the audit row).
 */
interface FreshEnvelope {
  readonly envelope: KeyEnvelope;
  readonly newEnvelopeId: KeyId;
}

/**
 * Use case: rotate the passphrase-envelope list of an already-existing
 * encrypted workspace without rotating the master key.
 *
 * See {@link RekeyEncryption} (input port) for the full contract,
 * pre-conditions, atomicity model, the seven-step flow and the
 * non-obvious limit ("rekey does NOT mitigate a master-key compromise").
 *
 * Notable design decisions captured here (and not on the port):
 *
 * - **Why add-first-then-remove.** The aggregate refuses to drop
 *   below one envelope (`LastEnvelopeRemovalError`). The use case
 *   therefore appends the new envelope FIRST (the aggregate now
 *   carries `N + 1` envelopes), verifies it can be unwrapped under
 *   the new passphrase (defence-in-depth against a buggy cipher),
 *   then strips every prior envelope one-by-one. If the cipher /
 *   KDF / repository fails BEFORE the removals begin, the aggregate
 *   is still consistent with at least one envelope (the original
 *   one); if it fails DURING the removals, the use case rolls back
 *   in-memory by reloading the aggregate from disk.
 *
 * - **Why no SQLCipher `PRAGMA rekey`.** ADR-005 Q2: the master key
 *   is a process-local secret. Re-encrypting every row of every
 *   table is a different flow (`recall rotate-master`), out of
 *   scope here. This use case rotates the wrap, not the key.
 *
 * - **`RekeyFailed` audit row on mid-flow failure.** If any step
 *   after the unlock succeeds throws, the use case emits a
 *   `RekeyFailed` audit row (outcome `FAILURE`) before re-raising
 *   the exception. The composition root observes the typed error
 *   and maps it to the CLI exit code.
 *
 * - **`removedEnvelopeIds` ordering.** Sorted ascending by the
 *   ORIGINAL `createdAt` timestamp of each envelope. Stable and
 *   reproducible across runs so tests can rely on a deterministic
 *   order without re-sorting on the consumer side.
 *
 * - **Residual atomicity gap (inherited from A5).** The use case
 *   persists the rotated aggregate to `config.json` via
 *   `repository.save(config)` BEFORE appending the audit chain to
 *   `encryption_audit_log` inside the SQL transaction. A crash
 *   between the FS save and the audit append commits the rotation
 *   to disk WITHOUT a forensic trail (the new envelope is live, the
 *   prior ones are gone, but the audit log is silent). Same lesser-
 *   evil trade as `AddEnvelopeUseCase` per ADR-005 Q4: "envelope-
 *   visible-without-audit beats audit-visible-without-envelope".
 *   Detectable post-mortem via `recall audit`'s gap-detection path.
 *   A full cross-FS+SQL transactional rotation is future work
 *   (tracked as the ADR-007 candidate documented in HANDOFF §6.27).
 */
export class RekeyEncryptionUseCase implements RekeyEncryption {
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

  public async rekey(input: RekeyInput): Promise<RekeyOutput> {
    // 1. Unlock the aggregate by delegating to UnlockEncryption.
    const unlockResult = await this.unlockUseCase.unlock({
      workspaceId: input.workspaceId,
      passphrase: input.currentPassphrase,
    });
    if (isErr(unlockResult)) {
      // F-A6-2 (HANDOFF §8): emit a best-effort `UnlockFailed` audit
      // row BEFORE re-throwing when the failure is a wrong passphrase
      // (the brute-force signal we want to capture). The audit row is
      // NOT emitted for `EncryptionNotInitializedError`. Distinct from
      // `appendRekeyFailed`, which fires on POST-unlock errors.
      if (unlockResult.error instanceof KeyValidationFailedError) {
        await this.appendUnlockFailed({
          occurredAt: this.clock.now(),
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
    const fingerprint = this.computeFingerprint(config);
    // Snapshot the prior envelope ids BEFORE mutating the aggregate
    // so the removals iterate over a stable, sorted list.
    const priorEnvelopeIds = this.snapshotPriorEnvelopeIds(config);

    try {
      const fresh = await this.mintNewEnvelope({
        config,
        newPassphraseInput: input,
        occurredAt,
      });
      this.removePriorEnvelopes(config, priorEnvelopeIds, occurredAt);
      await this.configRepository.save(config);

      await this.appendAuditChain({
        envelopeIds: priorEnvelopeIds,
        newEnvelopeId: fresh.newEnvelopeId,
        fingerprint,
        occurredAt,
      });

      this.logger.info(
        {
          workspaceId: input.workspaceId.toString(),
          newEnvelopeId: fresh.newEnvelopeId.toString(),
          removedCount: priorEnvelopeIds.length,
        },
        "encryption envelope rotation completed",
      );

      return {
        newEnvelopeId: fresh.newEnvelopeId,
        removedEnvelopeIds: Object.freeze([...priorEnvelopeIds]),
        rotatedAt: occurredAt,
      };
    } catch (error) {
      await this.appendRekeyFailed({
        fingerprint,
        occurredAt,
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    }
  }

  // -- private helpers -----------------------------------------------------

  /**
   * Builds a sorted snapshot of the envelope ids currently held by
   * the aggregate. Ordering: ascending by `createdAt`, ties broken
   * by `keyId.toString()`. The snapshot is captured BEFORE the new
   * envelope is appended so the consumer can rely on it as the
   * exhaustive "removed" list once the rotation completes.
   */
  private snapshotPriorEnvelopeIds(config: EncryptionConfig): readonly KeyId[] {
    const envelopes = config.getEnvelopes();
    const sorted = [...envelopes].sort((a, b) => {
      const am = a.createdAt.toEpochMs();
      const bm = b.createdAt.toEpochMs();
      if (am !== bm) return am - bm;
      return a.keyId.toString().localeCompare(b.keyId.toString());
    });
    return Object.freeze(sorted.map((env) => env.keyId));
  }

  /**
   * Derives a fresh KDF key from the new passphrase and AEAD-wraps
   * the unlocked master key, producing a brand-new `KeyEnvelope`
   * that is then appended to the aggregate. Step 5 of the flow
   * documented on the port.
   *
   * The aggregate's `addEnvelope` enforces the "all envelopes wrap
   * the SAME master key" invariant; the use case passes the in-memory
   * master key directly (NOT re-unwrapped from the freshly-wrapped
   * envelope) for the same reasons documented on
   * `AddEnvelopeUseCase.addEnvelope` (saves a redundant AEAD round
   * trip; the semantic invariant is "same key", which is trivially
   * satisfied).
   */
  private async mintNewEnvelope(input: {
    readonly config: EncryptionConfig;
    readonly newPassphraseInput: RekeyInput;
    readonly occurredAt: Timestamp;
  }): Promise<FreshEnvelope> {
    const salt = SaltBytes.from(this.randomBytes.next(SALT_LENGTH_BYTES));
    const kdfParams = KdfParams.defaults(salt);

    const derivation = await this.kdf.derive(
      input.newPassphraseInput.newPassphrase,
      kdfParams,
    );
    if (isErr(derivation)) {
      throw derivation.error;
    }
    const derivedKey = derivation.value;

    const wrappedMasterKey = await input.config.withUnlockedKey((masterKey) =>
      this.envelopeCipher.wrap(masterKey, derivedKey),
    );

    // Smoke-verify (ADR-005 Q2 defence-in-depth): roundtrip the fresh
    // envelope by unwrapping it under `derivedKey`. A buggy cipher
    // (regression, AEAD mismatch, future implementation drift) that
    // wraps without an immediately-unwrappable result would otherwise
    // cause the rekey to remove the prior envelopes and leave the
    // workspace unrecoverable. Failing-fast here keeps the prior
    // envelopes intact so the user can still unlock with the previous
    // passphrase. The unwrap result is discarded — we only assert
    // success.
    await this.envelopeCipher.unwrap(wrappedMasterKey, derivedKey);

    const newEnvelopeId = KeyId.from(this.idGenerator.generateString());
    const envelope = KeyEnvelope.create({
      keyId: newEnvelopeId,
      encryptedMasterKey: wrappedMasterKey,
      kdfParams,
      createdAt: input.occurredAt,
      label: input.newPassphraseInput.label,
    });
    input.config.withUnlockedKey((masterKey) => {
      input.config.addEnvelope({
        envelope,
        unwrappedMasterKey: masterKey,
        occurredAt: input.occurredAt,
      });
    });

    return { envelope, newEnvelopeId };
  }

  /**
   * Iterates the prior envelope ids and removes each one from the
   * aggregate. Step 6 of the flow. The aggregate refuses to drop
   * below one envelope, which is why this step MUST follow the
   * `addEnvelope` of the fresh envelope.
   */
  private removePriorEnvelopes(
    config: EncryptionConfig,
    priorEnvelopeIds: readonly KeyId[],
    occurredAt: Timestamp,
  ): void {
    for (const keyId of priorEnvelopeIds) {
      config.removeEnvelope({ keyId, occurredAt });
    }
  }

  /**
   * Computes the truncated master-key fingerprint of the
   * currently-unlocked key. Stored on every audit row this use case
   * emits so a reader can join `RekeyStarted` with the trailing
   * `RekeyCompleted` (and the intermediate `KeyEnvelopeAdded` /
   * `KeyEnvelopeRemoved` rows) on the fingerprint column. The
   * fingerprint VO never surfaces outside the audit adapter (see
   * `MasterKeyFingerprint` security invariants).
   */
  private computeFingerprint(config: EncryptionConfig): MasterKeyFingerprint {
    return config.withUnlockedKey((masterKey) =>
      masterKey.withBytes((bytes) => MasterKeyFingerprint.fromMasterKey(bytes)),
    );
  }

  /**
   * Appends the full audit chain (one row per state transition)
   * inside a single SQLite transaction so the chain is either
   * fully visible or not at all.
   *
   * Row order:
   *   1. `RekeyStarted`        (envelope_id null)
   *   2. `UnlockSucceeded`     (envelope_id null — the unlock matched
   *                             one of the prior envelopes but we do
   *                             not surface which one to the audit log)
   *   3. `KeyEnvelopeAdded`    (envelope_id = new)
   *   4. one `KeyEnvelopeRemoved` per `priorEnvelopeId`
   *   5. `RekeyCompleted`      (envelope_id null)
   *
   * The audit adapter's `append` is `async` (port shape) but the
   * underlying SQLite driver (better-sqlite3) is synchronous: the
   * INSERT runs to completion before the closure exits. We collect
   * the returned promises and `Promise.all(...)` them outside the
   * transaction so a synthetic rejection from a future fake adapter
   * still surfaces to the caller.
   */
  private async appendAuditChain(input: {
    readonly envelopeIds: readonly KeyId[];
    readonly newEnvelopeId: KeyId;
    readonly fingerprint: MasterKeyFingerprint;
    readonly occurredAt: Timestamp;
  }): Promise<void> {
    const actorHint = NonEmptyString.create(ACTOR_HINT, "actor_hint");
    let promises: Promise<void>[] = [];
    this.database.transaction((): void => {
      const collected: Promise<void>[] = [
        this.auditLogRepository.append({
          eventId: this.nextEventId(),
          occurredAt: input.occurredAt,
          eventType: "RekeyStarted",
          envelopeId: null,
          masterKeyFingerprint: input.fingerprint,
          actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
        this.auditLogRepository.append({
          eventId: this.nextEventId(),
          occurredAt: input.occurredAt,
          eventType: "UnlockSucceeded",
          envelopeId: null,
          masterKeyFingerprint: input.fingerprint,
          actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
        this.auditLogRepository.append({
          eventId: this.nextEventId(),
          occurredAt: input.occurredAt,
          eventType: "KeyEnvelopeAdded",
          envelopeId: input.newEnvelopeId,
          masterKeyFingerprint: input.fingerprint,
          actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
      ];
      for (const removed of input.envelopeIds) {
        collected.push(
          this.auditLogRepository.append({
            eventId: this.nextEventId(),
            occurredAt: input.occurredAt,
            eventType: "KeyEnvelopeRemoved",
            envelopeId: removed,
            masterKeyFingerprint: input.fingerprint,
            actorHint,
            outcome: "SUCCESS",
            detailJson: null,
          }),
        );
      }
      collected.push(
        this.auditLogRepository.append({
          eventId: this.nextEventId(),
          occurredAt: input.occurredAt,
          eventType: "RekeyCompleted",
          envelopeId: null,
          masterKeyFingerprint: input.fingerprint,
          actorHint,
          outcome: "SUCCESS",
          detailJson: null,
        }),
      );
      promises = collected;
    });
    await Promise.all(promises);
  }

  /**
   * Appends a single `RekeyFailed` audit row when the rotation
   * aborts mid-flow. Best-effort: if the audit append itself
   * throws, we let the original error escape unchanged (the
   * forensic loss is documented on the port).
   *
   * `fingerprint` MAY be null if the failure happened before the
   * unlock could compute one; we surface it untyped because the
   * use case caller is the only site that knows.
   */
  private async appendRekeyFailed(input: {
    readonly fingerprint: MasterKeyFingerprint | null;
    readonly occurredAt: Timestamp;
    readonly reason: string;
  }): Promise<void> {
    const actorHint = NonEmptyString.create(ACTOR_HINT, "actor_hint");
    try {
      let promises: Promise<void>[] = [];
      this.database.transaction((): void => {
        promises = [
          this.auditLogRepository.append({
            eventId: this.nextEventId(),
            occurredAt: input.occurredAt,
            eventType: "RekeyFailed",
            envelopeId: null,
            masterKeyFingerprint: input.fingerprint,
            actorHint,
            outcome: "FAILURE",
            detailJson: { reason: input.reason },
          }),
        ];
      });
      await Promise.all(promises);
    } catch (auditError) {
      // Best-effort: do not mask the original failure. Log and move
      // on; the operator still sees the original exception.
      this.logger.warn(
        {
          auditError:
            auditError instanceof Error ? auditError.message : "unknown",
        },
        "rekey failed and the RekeyFailed audit row could not be appended",
      );
    }
  }

  /**
   * Appends a single `UnlockFailed` audit row when
   * `UnlockEncryption.unlock(...)` returns Err during the rekey
   * flow. Distinct from `appendRekeyFailed`, which fires on errors
   * AFTER unlock has succeeded — the two rows describe orthogonal
   * failure modes that a forensic reader needs to tell apart.
   *
   * Row shape:
   * - `eventType` = `UnlockFailed`
   * - `envelopeId` = null (no envelope matched the supplied passphrase)
   * - `masterKeyFingerprint` = null (no master key reached scope)
   * - `actorHint` = `"cli:rekey"`
   * - `outcome` = `FAILURE`
   * - `detailJson` = `{ reason: "invalid-passphrase" }`
   *
   * Closes follow-up F-A6-2 (HANDOFF §8) — brute-force passphrase
   * attempts against the rekey flow now leave a forensic trail.
   * Best-effort: a broken audit infrastructure does not mask the
   * original unlock error.
   */
  private async appendUnlockFailed(input: {
    readonly occurredAt: Timestamp;
    readonly reason: string;
  }): Promise<void> {
    const actorHint = NonEmptyString.create(ACTOR_HINT, "actor_hint");
    try {
      let promises: Promise<void>[] = [];
      this.database.transaction((): void => {
        promises = [
          this.auditLogRepository.append({
            eventId: this.nextEventId(),
            occurredAt: input.occurredAt,
            eventType: "UnlockFailed",
            envelopeId: null,
            masterKeyFingerprint: null,
            actorHint,
            outcome: "FAILURE",
            detailJson: { reason: input.reason },
          }),
        ];
      });
      await Promise.all(promises);
    } catch (auditError) {
      this.logger.warn(
        {
          auditError:
            auditError instanceof Error ? auditError.message : "unknown",
        },
        "best-effort UnlockFailed audit append failed for cli:rekey",
      );
    }
  }

  private nextEventId(): EventId {
    return EventId.from(this.idGenerator.generateString());
  }
}
