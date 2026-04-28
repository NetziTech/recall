import { describe, it, expect } from "vitest";
import { InitializeEncryptionUseCase } from "../../../../src/modules/encryption/application/use-cases/initialize-encryption.use-case.ts";
import { Passphrase } from "../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { MasterKey } from "../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { DerivedKey } from "../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { EncryptedMasterKey } from "../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KeyValidatorBlob } from "../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { ok } from "../../../../src/shared/domain/types/result.ts";
import { DeterministicRandomBytes } from "../../../_fixtures/deterministic-random-bytes.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type { EncryptionConfig } from "../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import type { EncryptionConfigRepository } from "../../../../src/modules/encryption/domain/repositories/encryption-config-repository.ts";
import type { Kdf } from "../../../../src/modules/encryption/application/ports/out/kdf.port.ts";
import type { ValidatorEncrypter } from "../../../../src/modules/encryption/application/ports/out/validator-encrypter.port.ts";
import type { EnvelopeCipher } from "../../../../src/modules/encryption/domain/services/envelope-cipher.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

class InMemoryRepo implements EncryptionConfigRepository {
  public saved: EncryptionConfig | null = null;
  public deleted = false;

  public async findByWorkspace(): Promise<EncryptionConfig | null> {
    return this.saved;
  }
  public async save(config: EncryptionConfig): Promise<void> {
    this.saved = config;
  }
  public async delete(): Promise<void> {
    this.saved = null;
    this.deleted = true;
  }
}

const fakeKdf: Kdf = {
  derive: async (_p, _params) =>
    Promise.resolve(ok(DerivedKey.from(buf(32, 0xab)))),
};

const fakeEnvelopeCipher: EnvelopeCipher = {
  wrap: async (_mk, _dk) =>
    Promise.resolve(
      EncryptedMasterKey.create({
        ciphertext: buf(32, 0x10),
        iv: buf(12, 0x20),
        tag: buf(16, 0x30),
      }),
    ),
  unwrap: async (_e, _dk) => Promise.resolve(MasterKey.from(buf(32, 0xee))),
};

const fakeValidatorEncrypter: ValidatorEncrypter = {
  encrypt: async (input) =>
    Promise.resolve(
      KeyValidatorBlob.create({
        expectedPlaintext: input.plaintext,
        ciphertext: new Uint8Array(input.plaintext.length).fill(0x99),
        iv: buf(12, 0x40),
        tag: buf(16, 0x50),
      }),
    ),
};

const buildUseCase = (
  override?: {
    repo?: InMemoryRepo;
    kdf?: Kdf;
  },
): {
  useCase: InitializeEncryptionUseCase;
  repo: InMemoryRepo;
  logger: RecordingLogger;
} => {
  const repo = override?.repo ?? new InMemoryRepo();
  const logger = new RecordingLogger();
  const useCase = new InitializeEncryptionUseCase(
    repo,
    override?.kdf ?? fakeKdf,
    fakeEnvelopeCipher,
    fakeValidatorEncrypter,
    new DeterministicRandomBytes({ pattern: "counter" }),
    new FakeIdGenerator(),
    new FakeClock({ initialMs: 1_700_000_000_000 }),
    logger,
  );
  return { useCase, repo, logger };
};

describe("InitializeEncryptionUseCase", () => {
  it("happy path: builds + persists EncryptionConfig", async () => {
    const { useCase, repo } = buildUseCase();
    const config = await useCase.initialize({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("a-strong-passphrase"),
    });
    expect(config.envelopeCount()).toBe(1);
    expect(config.isUnlocked()).toBe(true);
    expect(repo.saved).toBe(config);
  });

  it("logs init event with public metadata only", async () => {
    const { useCase, logger } = buildUseCase();
    await useCase.initialize({
      workspaceId: WorkspaceId.from(WS_ID),
      passphrase: Passphrase.from("a-strong-passphrase"),
    });
    const infoEntry = logger.entries.find((e) => e.level === "info");
    expect(infoEntry?.message).toBe("encryption initialized");
  });

  it("rethrows KDF derivation errors", async () => {
    const failingKdf: Kdf = {
      derive: async () =>
        Promise.resolve({
          kind: "err",
          error: new (
            await import(
              "../../../../src/modules/encryption/domain/errors/weak-kdf-params-error.ts"
            )
          ).WeakKdfParamsError({
            parameter: "memory_kib",
            actual: 1,
            minimum: 65536,
          }),
        }),
    };
    const { useCase } = buildUseCase({ kdf: failingKdf });
    await expect(
      useCase.initialize({
        workspaceId: WorkspaceId.from(WS_ID),
        passphrase: Passphrase.from("a-strong-passphrase"),
      }),
    ).rejects.toThrow();
  });
});
