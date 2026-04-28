import { describe, it, expect } from "vitest";
import { DestroyEncryptionUseCase } from "../../../../src/modules/encryption/application/use-cases/destroy-encryption.use-case.ts";
import { EncryptionConfig } from "../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { Passphrase } from "../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { isOk, isErr, ok } from "../../../../src/shared/domain/types/result.ts";
import { EncryptionNotInitializedError } from "../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import { MasterKey } from "../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { DerivedKey } from "../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { KeyEnvelope } from "../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { EncryptedMasterKey } from "../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KeyValidatorBlob } from "../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { KdfSpec } from "../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type { EncryptionConfigRepository } from "../../../../src/modules/encryption/domain/repositories/encryption-config-repository.ts";
import type { EnvelopeCipher } from "../../../../src/modules/encryption/domain/services/envelope-cipher.ts";
import type { KeyValidator } from "../../../../src/modules/encryption/domain/services/key-validator.ts";
import type { Kdf } from "../../../../src/modules/encryption/application/ports/out/kdf.port.ts";
import type { DomainEvent } from "../../../../src/shared/domain/types/domain-event.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const ts = (epochMs: number): Timestamp => Timestamp.fromEpochMs(epochMs);

const rehydratedConfig = (): EncryptionConfig =>
  EncryptionConfig.rehydrate({
    workspaceId: WorkspaceId.from(WS_ID),
    kdfSpec: KdfSpec.argon2idDefaults(SaltBytes.from(buf(16, 7))),
    keyValidatorBlob: KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 1),
      iv: buf(12),
      tag: buf(16),
    }),
    envelopes: [
      KeyEnvelope.create({
        keyId: KeyId.from(KEY_ID),
        encryptedMasterKey: EncryptedMasterKey.create({
          ciphertext: buf(32, 1),
          iv: buf(12, 2),
          tag: buf(16, 3),
        }),
        kdfParams: KdfParams.defaults(SaltBytes.from(buf(16, 7))),
        createdAt: ts(1_700_000_000_000),
        label: null,
      }),
    ],
    createdAt: ts(1_700_000_000_000),
    updatedAt: ts(1_700_000_000_000),
  });

class StubRepo implements EncryptionConfigRepository {
  public constructor(public config: EncryptionConfig | null) {}
  public deleted = false;
  public async findByWorkspace(): Promise<EncryptionConfig | null> {
    return this.config;
  }
  public async save(): Promise<void> {}
  public async delete(): Promise<void> {
    this.deleted = true;
    this.config = null;
  }
}

const okKdf: Kdf = {
  derive: async () => Promise.resolve(ok(DerivedKey.from(buf(32, 0xab)))),
};

const successCipher: EnvelopeCipher = {
  wrap: async () =>
    Promise.resolve(
      EncryptedMasterKey.create({
        ciphertext: buf(32, 1),
        iv: buf(12, 2),
        tag: buf(16, 3),
      }),
    ),
  unwrap: async () => Promise.resolve(MasterKey.from(buf(32, 0xff))),
};

const aeadFailureCipher: EnvelopeCipher = {
  wrap: async () =>
    Promise.resolve(
      EncryptedMasterKey.create({
        ciphertext: buf(32, 1),
        iv: buf(12, 2),
        tag: buf(16, 3),
      }),
    ),
  unwrap: async () => {
    const e = new Error("auth failed") as Error & {
      code: string;
      kind: string;
    };
    e.code = "crypto.aead-failed";
    e.kind = "authentication-failed";
    throw e;
  },
};

const acceptingValidator: KeyValidator = {
  validate: async () => Promise.resolve(true),
};
const rejectingValidator: KeyValidator = {
  validate: async () => Promise.resolve(false),
};

describe("DestroyEncryptionUseCase", () => {
  it("destroys when passphrase matches", async () => {
    const config = rehydratedConfig();
    const repo = new StubRepo(config);
    const events: DomainEvent[] = [];
    const useCase = new DestroyEncryptionUseCase(
      repo,
      okKdf,
      successCipher,
      acceptingValidator,
      new FakeClock({ initialMs: 1_700_000_001_000 }),
      new RecordingLogger(),
      (e) => events.push(e),
    );
    const result = await useCase.destroy({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("strong-passphrase-here"),
    });
    expect(isOk(result)).toBe(true);
    expect(repo.deleted).toBe(true);
    expect(events[0]?.eventName).toBe("encryption.destroyed");
  });

  it("returns NotInitialized when missing", async () => {
    const repo = new StubRepo(null);
    const useCase = new DestroyEncryptionUseCase(
      repo,
      okKdf,
      successCipher,
      acceptingValidator,
      new FakeClock({ initialMs: 1 }),
      new RecordingLogger(),
      () => {},
    );
    const result = await useCase.destroy({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("strong-passphrase-here"),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(EncryptionNotInitializedError);
    }
  });

  it("returns KeyValidationFailed when passphrase wrong (AEAD fails)", async () => {
    const config = rehydratedConfig();
    const repo = new StubRepo(config);
    const useCase = new DestroyEncryptionUseCase(
      repo,
      okKdf,
      aeadFailureCipher,
      acceptingValidator,
      new FakeClock({ initialMs: 1 }),
      new RecordingLogger(),
      () => {},
    );
    const result = await useCase.destroy({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("strong-passphrase-here"),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(KeyValidationFailedError);
    }
    expect(repo.deleted).toBe(false);
  });

  it("returns KeyValidationFailed when validator rejects (defense in depth)", async () => {
    const config = rehydratedConfig();
    const repo = new StubRepo(config);
    const useCase = new DestroyEncryptionUseCase(
      repo,
      okKdf,
      successCipher,
      rejectingValidator,
      new FakeClock({ initialMs: 1 }),
      new RecordingLogger(),
      () => {},
    );
    const result = await useCase.destroy({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("strong-passphrase-here"),
    });
    expect(isErr(result)).toBe(true);
  });

  it("rethrows non-AEAD cipher errors", async () => {
    const config = rehydratedConfig();
    const repo = new StubRepo(config);
    const brokenCipher: EnvelopeCipher = {
      wrap: async () =>
        Promise.resolve(
          EncryptedMasterKey.create({
            ciphertext: buf(32),
            iv: buf(12),
            tag: buf(16),
          }),
        ),
      unwrap: async () => {
        throw new Error("subtle missing");
      },
    };
    const useCase = new DestroyEncryptionUseCase(
      repo,
      okKdf,
      brokenCipher,
      acceptingValidator,
      new FakeClock({ initialMs: 1 }),
      new RecordingLogger(),
      () => {},
    );
    await expect(
      useCase.destroy({
        workspaceId: WorkspaceId.from(WS_ID),
        passphrase: Passphrase.from("strong-passphrase-here"),
      }),
    ).rejects.toThrow("subtle missing");
  });
});
