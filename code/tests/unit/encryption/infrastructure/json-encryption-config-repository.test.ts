import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JsonEncryptionConfigRepository } from "../../../../src/modules/encryption/infrastructure/persistence/json-encryption-config-repository.ts";
import { EncryptionConfig } from "../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { MasterKey } from "../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { KeyEnvelope } from "../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { EncryptedMasterKey } from "../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KeyValidatorBlob } from "../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { KdfSpec } from "../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import { EncryptionConfigPersistenceError } from "../../../../src/modules/encryption/infrastructure/errors/encryption-config-persistence-error.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const ts = (epochMs: number): Timestamp => Timestamp.fromEpochMs(epochMs);

const makeConfig = (): EncryptionConfig =>
  EncryptionConfig.initialize({
    workspaceId: WorkspaceId.from(WS_ID),
    masterKey: MasterKey.from(buf(32, 0xff)),
    firstEnvelope: KeyEnvelope.create({
      keyId: KeyId.from(KEY_ID),
      encryptedMasterKey: EncryptedMasterKey.create({
        ciphertext: buf(32, 0xab),
        iv: buf(12, 0xcd),
        tag: buf(16, 0xef),
      }),
      kdfParams: KdfParams.defaults(SaltBytes.from(buf(16, 7))),
      createdAt: ts(1_700_000_000_000),
      label: null,
    }),
    kdfSpec: KdfSpec.argon2idDefaults(SaltBytes.from(buf(16, 7))),
    validatorBlob: KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID-WORKSPACE-V1"),
      ciphertext: buf(18, 0x55),
      iv: buf(12, 0x66),
      tag: buf(16, 0x77),
    }),
    occurredAt: ts(1_700_000_000_000),
  });

describe("JsonEncryptionConfigRepository", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        `enc-repo-${String(process.pid)}-${String(Date.now())}-${String(Math.random())}-`,
      ),
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("save() then findByWorkspace() round-trips", async () => {
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    const config = makeConfig();
    await repo.save(config);
    const loaded = await repo.findByWorkspace(WorkspaceId.from(WS_ID));
    expect(loaded).not.toBeNull();
    expect(loaded?.envelopeCount()).toBe(1);
    expect(loaded?.isUnlocked()).toBe(false); // rehydrated → locked
  });

  it("findByWorkspace returns null when no config", async () => {
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    const loaded = await repo.findByWorkspace(WorkspaceId.from(WS_ID));
    expect(loaded).toBeNull();
  });

  it("save writes file with mode 0o600", async () => {
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await repo.save(makeConfig());
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    const stat = await fs.stat(configPath);
    // On POSIX, mode lower bits should be 0o600 (octal 384)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("delete removes encryption slice but preserves other slices", async () => {
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    // Pre-populate with a workspace slice + encryption slice
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await repo.save(makeConfig());
    // Read the file, add an extra non-encryption key
    const existing = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    existing["unrelated_key"] = "preserved";
    await fs.writeFile(configPath, JSON.stringify(existing), "utf8");
    await repo.delete(WorkspaceId.from(WS_ID));
    const after = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(after.unrelated_key).toBe("preserved");
    expect(after.kdf).toBeUndefined();
    expect(after.key_envelopes).toBeUndefined();
  });

  it("delete is a no-op when no config file exists", async () => {
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await expect(
      repo.delete(WorkspaceId.from(WS_ID)),
    ).resolves.toBeUndefined();
  });

  it("rejects relative workspaceRoot", () => {
    expect(
      () =>
        new JsonEncryptionConfigRepository({
          workspaceRoot: "./relative",
          clock: new FakeClock({ initialMs: 1 }),
          logger: new RecordingLogger(),
        }),
    ).toThrow(EncryptionConfigPersistenceError);
  });

  it("rejects empty workspaceRoot", () => {
    expect(
      () =>
        new JsonEncryptionConfigRepository({
          workspaceRoot: "",
          clock: new FakeClock({ initialMs: 1 }),
          logger: new RecordingLogger(),
        }),
    ).toThrow(EncryptionConfigPersistenceError);
  });

  it("rejects null-byte in path", () => {
    expect(
      () =>
        new JsonEncryptionConfigRepository({
          workspaceRoot: "/tmp/foo\0bar",
          clock: new FakeClock({ initialMs: 1 }),
          logger: new RecordingLogger(),
        }),
    ).toThrow(EncryptionConfigPersistenceError);
  });

  it("rejects '..' segment that survives path.normalize", () => {
    // `..` after a relative root will survive path.normalize.
    expect(
      () =>
        new JsonEncryptionConfigRepository({
          workspaceRoot: "../traversal",
          clock: new FakeClock({ initialMs: 1 }),
          logger: new RecordingLogger(),
        }),
    ).toThrow(EncryptionConfigPersistenceError);
  });

  it("rejects malformed config.json (invalid JSON)", async () => {
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "not valid json {", "utf8");
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await expect(
      repo.findByWorkspace(WorkspaceId.from(WS_ID)),
    ).rejects.toThrow(EncryptionConfigPersistenceError);
  });

  it("returns null for partial encryption slice", async () => {
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ kdf: "argon2id", workspace_id: WS_ID }),
      "utf8",
    );
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    const loaded = await repo.findByWorkspace(WorkspaceId.from(WS_ID));
    expect(loaded).toBeNull();
  });

  it("rejects mismatched workspace_id", async () => {
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await repo.save(makeConfig());
    const otherId = "01952f3c-2222-7000-8000-bbbbbbbbbbbb";
    await expect(
      repo.findByWorkspace(WorkspaceId.from(otherId)),
    ).rejects.toThrow(EncryptionConfigPersistenceError);
  });

  it("disjoint slices: save preserves unrelated keys (workspace + encryption coexist)", async () => {
    const configPath = path.join(workspaceRoot, ".recall", "config.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        workspace_id: "some-other-id",
        mode: "shared",
      }),
      "utf8",
    );
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await repo.save(makeConfig());
    const after = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(after.mode).toBe("shared");
    expect(after.kdf).toBe("argon2id");
  });

  it("save round-trips multiple times keeping data consistent", async () => {
    const repo = new JsonEncryptionConfigRepository({
      workspaceRoot,
      clock: new FakeClock({ initialMs: 1 }),
      logger: new RecordingLogger(),
    });
    await repo.save(makeConfig());
    const loaded1 = await repo.findByWorkspace(WorkspaceId.from(WS_ID));
    if (loaded1 !== null) await repo.save(loaded1);
    const loaded2 = await repo.findByWorkspace(WorkspaceId.from(WS_ID));
    expect(loaded2).not.toBeNull();
    expect(loaded2?.envelopeCount()).toBe(1);
  });
});
