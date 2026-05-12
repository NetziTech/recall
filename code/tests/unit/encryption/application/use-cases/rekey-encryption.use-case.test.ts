import { describe, it, expect } from "vitest";

import { RekeyEncryptionUseCase } from "../../../../../src/modules/encryption/application/use-cases/rekey-encryption.use-case.ts";
import { EncryptionConfig } from "../../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { EncryptionLockedError } from "../../../../../src/modules/encryption/domain/errors/encryption-locked-error.ts";
import { EncryptionNotInitializedError } from "../../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import type { EncryptionAuditEvent } from "../../../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import type { EncryptionAuditLogRepository } from "../../../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import type { EncryptionConfigRepository } from "../../../../../src/modules/encryption/domain/repositories/encryption-config-repository.ts";
import type { EnvelopeCipher } from "../../../../../src/modules/encryption/domain/services/envelope-cipher.ts";
import { DerivedKey } from "../../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { EncryptedMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { KeyEnvelope } from "../../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";
import { KeyValidatorBlob } from "../../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { KdfSpec } from "../../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { MasterKey } from "../../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { Passphrase } from "../../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import type { Kdf } from "../../../../../src/modules/encryption/application/ports/out/kdf.port.ts";
import type { UnlockEncryption } from "../../../../../src/modules/encryption/application/ports/in/unlock-encryption.port.ts";
import type { DatabaseConnection } from "../../../../../src/shared/application/ports/database-connection.port.ts";
import { err, ok } from "../../../../../src/shared/domain/types/result.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { DeterministicRandomBytes } from "../../../../_fixtures/deterministic-random-bytes.ts";
import { RecordingLogger } from "../../../../_fixtures/silent-logger.ts";

// -- Test scaffolding ------------------------------------------------------

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const FIRST_KEY_ID = "01952f3b-7d8c-7b4a-b4f1-aaaaaaaaaaaa";
const SECOND_KEY_ID = "01952f3b-7d8c-7b4a-b4f1-bbbbbbbbbbbb";
const NEW_ENVELOPE_ID = "00000000-0000-7000-8000-0000000000a0";
const EV_REKEY_STARTED = "00000000-0000-7000-8000-0000000000e1";
const EV_UNLOCK_SUCCEEDED = "00000000-0000-7000-8000-0000000000e2";
const EV_ENVELOPE_ADDED = "00000000-0000-7000-8000-0000000000e3";
const EV_ENVELOPE_REMOVED_1 = "00000000-0000-7000-8000-0000000000e4";
const EV_ENVELOPE_REMOVED_2 = "00000000-0000-7000-8000-0000000000e5";
const EV_REKEY_COMPLETED = "00000000-0000-7000-8000-0000000000e6";
const EV_REKEY_FAILED = "00000000-0000-7000-8000-0000000000f0";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const MASTER_BYTES = buf(32, 0xee);

const makeKdfParams = (saltSeed = 0x11): KdfParams =>
  KdfParams.defaults(SaltBytes.from(buf(16, saltSeed)));

const makeEnvelope = (
  params: KdfParams,
  idStr: string,
  createdAtMs: number,
  labelText: string,
): KeyEnvelope =>
  KeyEnvelope.create({
    keyId: KeyId.from(idStr),
    encryptedMasterKey: EncryptedMasterKey.create({
      ciphertext: buf(32, 0x10),
      iv: buf(12, 0x20),
      tag: buf(16, 0x30),
    }),
    kdfParams: params,
    createdAt: Timestamp.fromEpochMs(createdAtMs),
    label: KeyLabel.create(labelText),
  });

/**
 * Builds an UNLOCKED `EncryptionConfig` with TWO envelopes (the
 * happy-path baseline): the first envelope was created earlier and
 * the second later, so the rekey snapshot sorts them in that order.
 */
const makeUnlockedTwoEnvelopeConfig = (): EncryptionConfig => {
  const kdfParams = makeKdfParams();
  const firstEnvelope = makeEnvelope(kdfParams, FIRST_KEY_ID, 1_700_000_000_000, "primary");
  const secondEnvelope = makeEnvelope(kdfParams, SECOND_KEY_ID, 1_700_000_500_000, "secondary");
  const config = EncryptionConfig.initialize({
    workspaceId: WorkspaceId.from(WS_ID),
    masterKey: MasterKey.from(MASTER_BYTES),
    firstEnvelope,
    kdfSpec: KdfSpec.create({
      algorithm: kdfParams.algorithm,
      params: kdfParams,
    }),
    validatorBlob: KeyValidatorBlob.create({
      expectedPlaintext: buf(18, 0x77),
      ciphertext: buf(18, 0x88),
      iv: buf(12, 0x40),
      tag: buf(16, 0x50),
    }),
    occurredAt: Timestamp.fromEpochMs(1_700_000_000_000),
  });
  // Drain the `EncryptionInitialized` event so subsequent operations
  // observe a clean event buffer.
  config.pullEvents();
  // Append the second envelope before the use case runs (mirrors
  // what `recall add-key` would have done in a prior session).
  config.withUnlockedKey((masterKey) => {
    config.addEnvelope({
      envelope: secondEnvelope,
      unwrappedMasterKey: masterKey,
      occurredAt: Timestamp.fromEpochMs(1_700_000_500_000),
    });
  });
  config.pullEvents();
  return config;
};

class InMemoryConfigRepo implements EncryptionConfigRepository {
  public stored: EncryptionConfig | null;
  public saveCount = 0;

  public constructor(initial: EncryptionConfig | null) {
    this.stored = initial;
  }
  public findByWorkspace(): Promise<EncryptionConfig | null> {
    return Promise.resolve(this.stored);
  }
  public save(config: EncryptionConfig): Promise<void> {
    this.stored = config;
    this.saveCount += 1;
    return Promise.resolve();
  }
  public delete(): Promise<void> {
    this.stored = null;
    return Promise.resolve();
  }
}

class RecordingAuditRepo implements EncryptionAuditLogRepository {
  public events: EncryptionAuditEvent[] = [];

  public append(event: EncryptionAuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class StubTransaction implements DatabaseConnection {
  public transactionCalls = 0;
  public prepare(): never {
    throw new Error("not used in this test");
  }
  public exec(): void {
    /* no-op */
  }
  public transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return fn();
  }
  public close(): void {
    /* no-op */
  }
}

const okKdf: Kdf = {
  derive: () => Promise.resolve(ok(DerivedKey.from(buf(32, 0xab)))),
};

const okCipher: EnvelopeCipher = {
  wrap: () =>
    Promise.resolve(
      EncryptedMasterKey.create({
        ciphertext: buf(32, 0x60),
        iv: buf(12, 0x61),
        tag: buf(16, 0x62),
      }),
    ),
  unwrap: () => Promise.resolve(MasterKey.from(MASTER_BYTES)),
};

class StubUnlockEncryption implements UnlockEncryption {
  public unlockCalls = 0;
  public constructor(
    private readonly outcome:
      | { kind: "ok"; config: EncryptionConfig }
      | { kind: "not-initialized" }
      | { kind: "wrong-passphrase" },
  ) {}
  public unlock(): ReturnType<UnlockEncryption["unlock"]> {
    this.unlockCalls += 1;
    if (this.outcome.kind === "ok") {
      return Promise.resolve(ok(this.outcome.config));
    }
    if (this.outcome.kind === "not-initialized") {
      return Promise.resolve(
        err(new EncryptionNotInitializedError(WorkspaceId.from(WS_ID))),
      );
    }
    return Promise.resolve(
      err(new KeyValidationFailedError(WorkspaceId.from(WS_ID))),
    );
  }
}

interface BuildOptions {
  readonly initialConfig?: EncryptionConfig | null;
  readonly unlockOutcome?: "ok" | "not-initialized" | "wrong-passphrase";
  readonly cipher?: EnvelopeCipher;
}

const build = (override: BuildOptions = {}) => {
  const initial =
    override.initialConfig === undefined
      ? makeUnlockedTwoEnvelopeConfig()
      : override.initialConfig;
  const repo = new InMemoryConfigRepo(initial);
  const audit = new RecordingAuditRepo();
  const db = new StubTransaction();
  const logger = new RecordingLogger();
  const unlockOutcome = override.unlockOutcome ?? "ok";
  const unlock = new StubUnlockEncryption(
    unlockOutcome === "ok"
      ? { kind: "ok", config: initial ?? makeUnlockedTwoEnvelopeConfig() }
      : unlockOutcome === "not-initialized"
        ? { kind: "not-initialized" }
        : { kind: "wrong-passphrase" },
  );
  const useCase = new RekeyEncryptionUseCase(
    unlock,
    repo,
    audit,
    okKdf,
    override.cipher ?? okCipher,
    new DeterministicRandomBytes({ pattern: "counter" }),
    new FakeIdGenerator({
      sequence: [
        NEW_ENVELOPE_ID,
        EV_REKEY_STARTED,
        EV_UNLOCK_SUCCEEDED,
        EV_ENVELOPE_ADDED,
        EV_ENVELOPE_REMOVED_1,
        EV_ENVELOPE_REMOVED_2,
        EV_REKEY_COMPLETED,
        EV_REKEY_FAILED,
      ],
    }),
    new FakeClock({ initialMs: 1_700_000_900_000 }),
    db,
    logger,
  );
  return { useCase, repo, audit, db, logger, unlock };
};

// -- Tests -----------------------------------------------------------------

describe("RekeyEncryptionUseCase", () => {
  it("happy path: rotates envelopes, persists once, emits the full audit chain", async () => {
    const { useCase, repo, audit, db } = build();

    const output = await useCase.rekey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
      newPassphrase: Passphrase.from("another-strong-passphrase"),
      label: KeyLabel.create("rotated@2026"),
    });

    // Output carries the freshly minted envelope id + the two
    // removed ids in stable ascending order (createdAt).
    expect(output.newEnvelopeId.toString()).toBe(NEW_ENVELOPE_ID);
    expect(output.removedEnvelopeIds.map((id) => id.toString())).toEqual([
      FIRST_KEY_ID,
      SECOND_KEY_ID,
    ]);
    expect(output.rotatedAt.toEpochMs()).toBe(1_700_000_900_000);

    // Aggregate state: only the new envelope survives.
    expect(repo.stored?.envelopeCount()).toBe(1);
    expect(repo.stored?.isUnlocked()).toBe(true);
    const remaining = repo.stored?.getEnvelopes() ?? [];
    expect(remaining[0]?.keyId.toString()).toBe(NEW_ENVELOPE_ID);
    expect(repo.saveCount).toBe(1);

    // Audit chain: 6 rows (RekeyStarted, UnlockSucceeded,
    // KeyEnvelopeAdded, KeyEnvelopeRemoved × 2, RekeyCompleted).
    expect(audit.events).toHaveLength(6);
    const types = audit.events.map((e) => e.eventType);
    expect(types).toEqual([
      "RekeyStarted",
      "UnlockSucceeded",
      "KeyEnvelopeAdded",
      "KeyEnvelopeRemoved",
      "KeyEnvelopeRemoved",
      "RekeyCompleted",
    ]);

    // All rows share the same master-key fingerprint (master is stable).
    const firstFp = audit.events[0]?.masterKeyFingerprint;
    expect(firstFp).not.toBeNull();
    for (const row of audit.events) {
      expect(row.masterKeyFingerprint).not.toBeNull();
      expect(row.masterKeyFingerprint?.equals(firstFp ?? row.masterKeyFingerprint!)).toBe(
        true,
      );
      expect(row.outcome).toBe("SUCCESS");
      expect(row.actorHint.toString()).toBe("cli:rekey");
    }
    // The added row carries the new envelope id; the removed rows
    // carry the prior ones (in snapshot order).
    expect(audit.events[2]?.envelopeId?.toString()).toBe(NEW_ENVELOPE_ID);
    expect(audit.events[3]?.envelopeId?.toString()).toBe(FIRST_KEY_ID);
    expect(audit.events[4]?.envelopeId?.toString()).toBe(SECOND_KEY_ID);

    // The chain was committed inside ONE transaction.
    expect(db.transactionCalls).toBe(1);
  });

  it("throws EncryptionNotInitializedError when the unlock use case reports the config is missing", async () => {
    const { useCase, repo, audit, db } = build({
      initialConfig: null,
      unlockOutcome: "not-initialized",
    });
    await expect(
      useCase.rekey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(EncryptionNotInitializedError);
    // No write side effects (no save, no audit chain), no transaction.
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(0);
    expect(db.transactionCalls).toBe(0);
  });

  it("throws KeyValidationFailedError when the current passphrase is wrong", async () => {
    const { useCase, repo, audit, db } = build({
      unlockOutcome: "wrong-passphrase",
    });
    await expect(
      useCase.rekey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("incorrect-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(KeyValidationFailedError);
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(0);
    expect(db.transactionCalls).toBe(0);
  });

  it("defensive: throws EncryptionLockedError if unlock returns a still-locked aggregate", async () => {
    const lockedConfig = makeUnlockedTwoEnvelopeConfig();
    lockedConfig.lock({ occurredAt: Timestamp.fromEpochMs(1_700_000_800_000) });
    lockedConfig.pullEvents();
    const { useCase, repo, audit } = build({ initialConfig: lockedConfig });
    await expect(
      useCase.rekey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(EncryptionLockedError);
    expect(repo.saveCount).toBe(0);
    // The defensive `EncryptionLockedError` is thrown BEFORE the
    // try/catch block in `rekey(...)`, so no `RekeyFailed` audit row
    // is emitted. The aggregate-state check is gate, not work.
    expect(audit.events).toHaveLength(0);
  });

  it("emits RekeyFailed audit row when cipher.wrap throws mid-flow", async () => {
    const failingCipher: EnvelopeCipher = {
      wrap: () => Promise.reject(new Error("AEAD primitive failed")),
      unwrap: () => Promise.resolve(MasterKey.from(MASTER_BYTES)),
    };
    const { useCase, repo, audit } = build({ cipher: failingCipher });
    await expect(
      useCase.rekey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toThrow("AEAD primitive failed");
    // The aggregate was NOT persisted (the failure happened before
    // `save`); only the `RekeyFailed` audit row was emitted.
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.eventType).toBe("RekeyFailed");
    expect(audit.events[0]?.outcome).toBe("FAILURE");
    expect(audit.events[0]?.detailJson).toMatchObject({
      reason: "AEAD primitive failed",
    });
  });

  it("emits RekeyFailed when the smoke-verify (cipher.unwrap) fails on the freshly-wrapped envelope", async () => {
    // Defence-in-depth (ADR-005 Q2 + security-auditor follow-up):
    // a buggy cipher that produces non-unwrappable ciphertext must
    // fail-fast BEFORE the prior envelopes are removed. The prior
    // envelope must survive so the user can still unlock with the
    // previous passphrase.
    const buggyCipher: EnvelopeCipher = {
      wrap: () =>
        Promise.resolve(
          EncryptedMasterKey.create({
            ciphertext: buf(32, 0x60),
            iv: buf(12, 0x61),
            tag: buf(16, 0x62),
          }),
        ),
      unwrap: () => Promise.reject(new Error("AEAD authentication failed")),
    };
    const { useCase, repo, audit } = build({ cipher: buggyCipher });
    await expect(
      useCase.rekey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toThrow("AEAD authentication failed");
    // The aggregate must not have been persisted; the prior envelopes
    // (intact in memory only) are still recoverable via the previous
    // passphrase.
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.eventType).toBe("RekeyFailed");
    expect(audit.events[0]?.outcome).toBe("FAILURE");
    expect(audit.events[0]?.detailJson).toMatchObject({
      reason: "AEAD authentication failed",
    });
  });

  it("removedEnvelopeIds is sorted ascending by original createdAt timestamp", async () => {
    // Build a config where the SECOND envelope was created BEFORE
    // the first one (createdAt order inverted from insertion order).
    // The snapshot must surface them in createdAt order regardless.
    const kdfParams = makeKdfParams();
    const newer = makeEnvelope(kdfParams, FIRST_KEY_ID, 1_700_000_800_000, "newer");
    const older = makeEnvelope(kdfParams, SECOND_KEY_ID, 1_700_000_100_000, "older");
    const config = EncryptionConfig.initialize({
      workspaceId: WorkspaceId.from(WS_ID),
      masterKey: MasterKey.from(MASTER_BYTES),
      firstEnvelope: newer,
      kdfSpec: KdfSpec.create({
        algorithm: kdfParams.algorithm,
        params: kdfParams,
      }),
      validatorBlob: KeyValidatorBlob.create({
        expectedPlaintext: buf(18, 0x77),
        ciphertext: buf(18, 0x88),
        iv: buf(12, 0x40),
        tag: buf(16, 0x50),
      }),
      occurredAt: Timestamp.fromEpochMs(1_700_000_800_000),
    });
    config.pullEvents();
    config.withUnlockedKey((masterKey) => {
      config.addEnvelope({
        envelope: older,
        unwrappedMasterKey: masterKey,
        occurredAt: Timestamp.fromEpochMs(1_700_000_100_000),
      });
    });
    config.pullEvents();

    const { useCase } = build({ initialConfig: config });
    const output = await useCase.rekey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
      newPassphrase: Passphrase.from("another-strong-passphrase"),
      label: null,
    });
    // Sorted by createdAt: older (1_700_000_100_000) first, then
    // newer (1_700_000_800_000). The KeyIds match accordingly.
    expect(output.removedEnvelopeIds.map((id) => id.toString())).toEqual([
      SECOND_KEY_ID,
      FIRST_KEY_ID,
    ]);
  });
});
