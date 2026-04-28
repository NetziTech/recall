import { describe, it, expect } from "vitest";
import { LockEncryptionUseCase } from "../../../../src/modules/encryption/application/use-cases/lock-encryption.use-case.ts";
import { EncryptionConfig } from "../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { isOk, isErr } from "../../../../src/shared/domain/types/result.ts";
import { EncryptionNotInitializedError } from "../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { MasterKey } from "../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { KeyEnvelope } from "../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { EncryptedMasterKey } from "../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KeyValidatorBlob } from "../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { KdfSpec } from "../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type { EncryptionConfigRepository } from "../../../../src/modules/encryption/domain/repositories/encryption-config-repository.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const ts = (epochMs: number): Timestamp => Timestamp.fromEpochMs(epochMs);

const buildConfig = (): EncryptionConfig =>
  EncryptionConfig.initialize({
    workspaceId: WorkspaceId.from(WS_ID),
    masterKey: MasterKey.from(buf(32, 0xff)),
    firstEnvelope: KeyEnvelope.create({
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
    kdfSpec: KdfSpec.argon2idDefaults(SaltBytes.from(buf(16, 7))),
    validatorBlob: KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 1),
      iv: buf(12),
      tag: buf(16),
    }),
    occurredAt: ts(1_700_000_000_000),
  });

class StubRepo implements EncryptionConfigRepository {
  public constructor(public config: EncryptionConfig | null) {}
  public saved: EncryptionConfig | null = null;
  public async findByWorkspace(): Promise<EncryptionConfig | null> {
    return this.config;
  }
  public async save(c: EncryptionConfig): Promise<void> {
    this.saved = c;
  }
  public async delete(): Promise<void> {
    this.config = null;
  }
}

describe("LockEncryptionUseCase", () => {
  it("locks an unlocked config", async () => {
    const config = buildConfig();
    const repo = new StubRepo(config);
    const useCase = new LockEncryptionUseCase(
      repo,
      new FakeClock({ initialMs: 1_700_000_001_000 }),
      new RecordingLogger(),
    );
    const result = await useCase.lock({ workspaceId: WorkspaceId.from(WS_ID) });
    expect(isOk(result)).toBe(true);
    expect(config.isUnlocked()).toBe(false);
    expect(repo.saved).toBe(config);
  });

  it("returns EncryptionNotInitializedError when missing", async () => {
    const repo = new StubRepo(null);
    const useCase = new LockEncryptionUseCase(
      repo,
      new FakeClock({ initialMs: 1 }),
      new RecordingLogger(),
    );
    const result = await useCase.lock({ workspaceId: WorkspaceId.from(WS_ID) });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(EncryptionNotInitializedError);
    }
  });
});
