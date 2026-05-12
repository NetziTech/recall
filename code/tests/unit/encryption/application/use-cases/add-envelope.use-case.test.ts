import { describe, it, expect } from "vitest";

import { AddEnvelopeUseCase } from "../../../../../src/modules/encryption/application/use-cases/add-envelope.use-case.ts";
import { EncryptionConfig } from "../../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { EncryptionLockedError } from "../../../../../src/modules/encryption/domain/errors/encryption-locked-error.ts";
import { EncryptionNotInitializedError } from "../../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
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
import { KeyValidationFailedError } from "../../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import type { DatabaseConnection } from "../../../../../src/shared/application/ports/database-connection.port.ts";
import { err, ok } from "../../../../../src/shared/domain/types/result.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { DeterministicRandomBytes } from "../../../../_fixtures/deterministic-random-bytes.ts";
import { RecordingLogger } from "../../../../_fixtures/silent-logger.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const FIRST_KEY_ID = "01952f3b-7d8c-7b4a-b4f1-aaaaaaaaaaaa";
const NEW_ENVELOPE_ID = "00000000-0000-7000-8000-000000000001";
const UNLOCK_EVENT_ID = "00000000-0000-7000-8000-000000000002";
const ADDED_EVENT_ID = "00000000-0000-7000-8000-000000000003";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const MASTER_BYTES = buf(32, 0xee);

const makeKdfParams = (saltSeed = 0x11): KdfParams =>
  KdfParams.defaults(SaltBytes.from(buf(16, saltSeed)));

const makeEnvelope = (params: KdfParams, idStr: string): KeyEnvelope =>
  KeyEnvelope.create({
    keyId: KeyId.from(idStr),
    encryptedMasterKey: EncryptedMasterKey.create({
      ciphertext: buf(32, 0x10),
      iv: buf(12, 0x20),
      tag: buf(16, 0x30),
    }),
    kdfParams: params,
    createdAt: Timestamp.fromEpochMs(1_700_000_000_000),
    label: KeyLabel.create("primary"),
  });

const makeUnlockedConfig = (): EncryptionConfig => {
  const kdfParams = makeKdfParams();
  const firstEnvelope = makeEnvelope(kdfParams, FIRST_KEY_ID);
  return EncryptionConfig.initialize({
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
};

class InMemoryConfigRepo implements EncryptionConfigRepository {
  public stored: EncryptionConfig | null;
  public saveCount = 0;

  public constructor(initial: EncryptionConfig | null) {
    this.stored = initial;
  }

  public async findByWorkspace(): Promise<EncryptionConfig | null> {
    return this.stored;
  }
  public async save(config: EncryptionConfig): Promise<void> {
    this.stored = config;
    this.saveCount += 1;
  }
  public async delete(): Promise<void> {
    this.stored = null;
  }
}

class RecordingAuditRepo implements EncryptionAuditLogRepository {
  public events: EncryptionAuditEvent[] = [];

  public async append(event: EncryptionAuditEvent): Promise<void> {
    this.events.push(event);
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

const fakeKdf: Kdf = {
  derive: async () => Promise.resolve(ok(DerivedKey.from(buf(32, 0xab)))),
};

const fakeCipher: EnvelopeCipher = {
  wrap: async () =>
    Promise.resolve(
      EncryptedMasterKey.create({
        ciphertext: buf(32, 0x60),
        iv: buf(12, 0x61),
        tag: buf(16, 0x62),
      }),
    ),
  unwrap: async () => Promise.resolve(MasterKey.from(MASTER_BYTES)),
};

/**
 * Stub `UnlockEncryption` that drives the test scenarios:
 * - `unlockOutcome === "ok"`: returns ok(config) where config is the
 *   in-memory unlocked aggregate (mirrors the real use case after a
 *   successful unlock).
 * - `unlockOutcome === "not-initialized"`: returns err(EncryptionNot...).
 * - `unlockOutcome === "wrong-passphrase"`: returns err(KeyValidationFailed).
 */
class StubUnlockEncryption implements UnlockEncryption {
  public unlockCalls = 0;
  public constructor(
    private readonly outcome:
      | { kind: "ok"; config: EncryptionConfig }
      | { kind: "not-initialized" }
      | { kind: "wrong-passphrase" },
  ) {}
  public async unlock(): ReturnType<UnlockEncryption["unlock"]> {
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

const build = (
  override: {
    initialConfig?: EncryptionConfig | null;
    unlockOutcome?: "ok" | "not-initialized" | "wrong-passphrase";
  } = {},
): {
  useCase: AddEnvelopeUseCase;
  repo: InMemoryConfigRepo;
  audit: RecordingAuditRepo;
  db: StubTransaction;
  logger: RecordingLogger;
  unlock: StubUnlockEncryption;
} => {
  const initial =
    override.initialConfig === undefined
      ? makeUnlockedConfig()
      : override.initialConfig;
  const repo = new InMemoryConfigRepo(initial);
  const audit = new RecordingAuditRepo();
  const db = new StubTransaction();
  const logger = new RecordingLogger();
  const unlockOutcome = override.unlockOutcome ?? "ok";
  const unlock = new StubUnlockEncryption(
    unlockOutcome === "ok"
      ? { kind: "ok", config: initial ?? makeUnlockedConfig() }
      : unlockOutcome === "not-initialized"
        ? { kind: "not-initialized" }
        : { kind: "wrong-passphrase" },
  );
  const useCase = new AddEnvelopeUseCase(
    unlock,
    repo,
    audit,
    fakeKdf,
    fakeCipher,
    new DeterministicRandomBytes({ pattern: "counter" }),
    new FakeIdGenerator({
      sequence: [NEW_ENVELOPE_ID, UNLOCK_EVENT_ID, ADDED_EVENT_ID],
    }),
    new FakeClock({ initialMs: 1_700_000_900_000 }),
    db,
    logger,
  );
  return { useCase, repo, audit, db, logger, unlock };
};

describe("AddEnvelopeUseCase", () => {
  it("happy path: appends new envelope, persists config, audits the pair", async () => {
    const { useCase, repo, audit, db } = build();

    const output = await useCase.addEnvelope({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
      newPassphrase: Passphrase.from("another-strong-passphrase"),
      label: KeyLabel.create("alice@laptop"),
    });

    // Output carries the freshly minted envelope id + timestamp.
    expect(output.envelopeId.toString()).toBe(NEW_ENVELOPE_ID);
    expect(output.addedAt.toEpochMs()).toBe(1_700_000_900_000);

    // Aggregate state: the new envelope is the second one and the
    // workspace remained unlocked under the same master key.
    expect(repo.stored?.envelopeCount()).toBe(2);
    expect(repo.stored?.isUnlocked()).toBe(true);
    expect(repo.saveCount).toBe(1);

    // Audit pair: two rows, both carrying the SAME master-key
    // fingerprint, both with outcome=SUCCESS, the second one carrying
    // the new envelope id.
    expect(audit.events).toHaveLength(2);
    const [unlockEvt, addedEvt] = audit.events;
    expect(unlockEvt?.eventType).toBe("UnlockSucceeded");
    expect(unlockEvt?.envelopeId).toBeNull();
    expect(unlockEvt?.outcome).toBe("SUCCESS");
    expect(unlockEvt?.masterKeyFingerprint).not.toBeNull();
    expect(addedEvt?.eventType).toBe("KeyEnvelopeAdded");
    expect(addedEvt?.envelopeId?.toString()).toBe(NEW_ENVELOPE_ID);
    expect(addedEvt?.outcome).toBe("SUCCESS");
    expect(
      unlockEvt?.masterKeyFingerprint?.equals(
        addedEvt?.masterKeyFingerprint ??
          unlockEvt.masterKeyFingerprint,
      ),
    ).toBe(true);

    // The pair was committed inside one transaction.
    expect(db.transactionCalls).toBe(1);
  });

  it("throws EncryptionNotInitializedError when the unlock use case reports the config is missing", async () => {
    const { useCase, repo, audit } = build({
      initialConfig: null,
      unlockOutcome: "not-initialized",
    });
    await expect(
      useCase.addEnvelope({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(EncryptionNotInitializedError);
    // No write side effects.
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(0);
  });

  it("throws KeyValidationFailedError when the current passphrase is wrong", async () => {
    const { useCase, repo, audit } = build({ unlockOutcome: "wrong-passphrase" });
    await expect(
      useCase.addEnvelope({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("incorrect-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(KeyValidationFailedError);
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(0);
  });

  it("defensive: throws EncryptionLockedError if unlock returns a still-locked aggregate", async () => {
    const lockedConfig = makeUnlockedConfig();
    lockedConfig.pullEvents();
    lockedConfig.lock({ occurredAt: Timestamp.fromEpochMs(1_700_000_800_000) });
    const { useCase, repo, audit } = build({ initialConfig: lockedConfig });
    await expect(
      useCase.addEnvelope({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
        newPassphrase: Passphrase.from("another-strong-passphrase"),
        label: null,
      }),
    ).rejects.toBeInstanceOf(EncryptionLockedError);
    expect(repo.saveCount).toBe(0);
    expect(audit.events).toHaveLength(0);
  });

  it("preserves the original envelope (does not replace, appends)", async () => {
    const { useCase, repo } = build();
    await useCase.addEnvelope({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
      newPassphrase: Passphrase.from("another-strong-passphrase"),
      label: null,
    });
    const envelopes = repo.stored?.getEnvelopes() ?? [];
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]?.keyId.toString()).toBe(FIRST_KEY_ID);
    expect(envelopes[1]?.keyId.toString()).toBe(NEW_ENVELOPE_ID);
  });
});
