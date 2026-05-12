import { describe, it, expect } from "vitest";

import { ExportMasterKeyUseCase } from "../../../../../src/modules/encryption/application/use-cases/export-master-key.use-case.ts";
import { EncryptionConfig } from "../../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { EncryptionNotInitializedError } from "../../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import type { EncryptionAuditEvent } from "../../../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import type { EncryptionAuditLogRepository } from "../../../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import { EncryptedMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { KdfSpec } from "../../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { KeyEnvelope } from "../../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";
import { KeyValidatorBlob } from "../../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { MasterKey } from "../../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { MasterKeyFingerprint } from "../../../../../src/modules/encryption/domain/value-objects/master-key-fingerprint.ts";
import { Passphrase } from "../../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { PrintableMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/printable-master-key.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import type { UnlockEncryption } from "../../../../../src/modules/encryption/application/ports/in/unlock-encryption.port.ts";
import type { DatabaseConnection } from "../../../../../src/shared/application/ports/database-connection.port.ts";
import { err, ok } from "../../../../../src/shared/domain/types/result.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { RecordingLogger } from "../../../../_fixtures/silent-logger.ts";

// -- Test scaffolding ------------------------------------------------------

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const FIRST_KEY_ID = "01952f3b-7d8c-7b4a-b4f1-aaaaaaaaaaaa";
const EV_EXPORT_EMITTED = "00000000-0000-7000-8000-0000000000a1";
const EXPORT_TS_MS = 1_700_000_900_000;

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const MASTER_BYTES = buf(32, 0xee);

const makeKdfParams = (saltSeed = 0x11): KdfParams =>
  KdfParams.defaults(SaltBytes.from(buf(16, saltSeed)));

const makeEnvelope = (params: KdfParams): KeyEnvelope =>
  KeyEnvelope.create({
    keyId: KeyId.from(FIRST_KEY_ID),
    encryptedMasterKey: EncryptedMasterKey.create({
      ciphertext: buf(32, 0x10),
      iv: buf(12, 0x20),
      tag: buf(16, 0x30),
    }),
    kdfParams: params,
    createdAt: Timestamp.fromEpochMs(1_700_000_000_000),
    label: KeyLabel.create("primary"),
  });

/**
 * Builds an UNLOCKED `EncryptionConfig` with one envelope. Mirrors
 * the rekey test's baseline; export does not need a multi-envelope
 * fixture because it never mutates the list.
 */
const makeUnlockedConfig = (): EncryptionConfig => {
  const kdfParams = makeKdfParams();
  const config = EncryptionConfig.initialize({
    workspaceId: WorkspaceId.from(WS_ID),
    masterKey: MasterKey.from(MASTER_BYTES),
    firstEnvelope: makeEnvelope(kdfParams),
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
  config.pullEvents();
  return config;
};

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
  readonly unlockOutcome?: "ok" | "not-initialized" | "wrong-passphrase";
}

const build = (override: BuildOptions = {}) => {
  const config = makeUnlockedConfig();
  const audit = new RecordingAuditRepo();
  const db = new StubTransaction();
  const logger = new RecordingLogger();
  const unlockOutcome = override.unlockOutcome ?? "ok";
  const unlock = new StubUnlockEncryption(
    unlockOutcome === "ok"
      ? { kind: "ok", config }
      : unlockOutcome === "not-initialized"
        ? { kind: "not-initialized" }
        : { kind: "wrong-passphrase" },
  );
  const useCase = new ExportMasterKeyUseCase(
    unlock,
    audit,
    new FakeIdGenerator({ sequence: [EV_EXPORT_EMITTED] }),
    new FakeClock({ initialMs: EXPORT_TS_MS }),
    db,
    logger,
  );
  return { useCase, audit, db, logger, unlock, config };
};

// -- Tests -----------------------------------------------------------------

describe("ExportMasterKeyUseCase", () => {
  it("happy path: renders the master key, emits exactly one ExportKeyEmitted audit row", async () => {
    const { useCase, audit, db } = build();

    const output = await useCase.exportMasterKey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
    });

    // The output wraps the SAME 32 bytes the aggregate holds.
    expect(output.printableMasterKey.unwrap()).toEqual(MASTER_BYTES);
    // exportedAt is the canonical clock timestamp.
    expect(output.exportedAt.toEpochMs()).toBe(EXPORT_TS_MS);

    // Audit chain: exactly one row.
    expect(audit.events).toHaveLength(1);
    const row = audit.events[0];
    expect(row?.eventType).toBe("ExportKeyEmitted");
    expect(row?.outcome).toBe("SUCCESS");
    expect(row?.actorHint.toString()).toBe("cli:export-key");
    expect(row?.envelopeId).toBeNull();
    expect(row?.detailJson).toBeNull();

    // master_key_fp is set and matches the master key the aggregate holds.
    expect(row?.masterKeyFingerprint).not.toBeNull();
    const expectedFp = MasterKeyFingerprint.fromMasterKey(MASTER_BYTES);
    expect(row?.masterKeyFingerprint?.equals(expectedFp)).toBe(true);

    // The audit row was committed inside ONE transaction.
    expect(db.transactionCalls).toBe(1);
  });

  it("throws EncryptionNotInitializedError when the unlock use case reports the config is missing", async () => {
    const { useCase, audit, db } = build({ unlockOutcome: "not-initialized" });
    await expect(
      useCase.exportMasterKey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("current-strong-passphrase"),
      }),
    ).rejects.toBeInstanceOf(EncryptionNotInitializedError);
    // No audit row, no transaction.
    expect(audit.events).toHaveLength(0);
    expect(db.transactionCalls).toBe(0);
  });

  it("throws KeyValidationFailedError when the current passphrase is wrong", async () => {
    const { useCase, audit, db } = build({ unlockOutcome: "wrong-passphrase" });
    await expect(
      useCase.exportMasterKey({
        workspaceId: WorkspaceId.from(WS_ID),
        currentPassphrase: Passphrase.from("incorrect-passphrase"),
      }),
    ).rejects.toBeInstanceOf(KeyValidationFailedError);
    // No audit row emitted for a failed unlock — the master key was
    // never observed in scope.
    expect(audit.events).toHaveLength(0);
    expect(db.transactionCalls).toBe(0);
  });

  it("the printable master key roundtrips through PrintableMasterKey.fromString to the same bytes", async () => {
    const { useCase } = build();
    const output = await useCase.exportMasterKey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
    });

    // Spec invariants from `docs/11 §3`:
    const canonical = output.printableMasterKey.toString();
    expect(canonical.length).toBe(PrintableMasterKey.renderedLength());
    expect(canonical.startsWith(`${PrintableMasterKey.hrp()}1`)).toBe(true);

    // Parse the rendered form back; bytes must match the original.
    const parsed = PrintableMasterKey.fromString(canonical);
    expect(parsed.unwrap()).toEqual(MASTER_BYTES);
    expect(parsed.equals(output.printableMasterKey)).toBe(true);
  });

  it("emits exactly one ExportKeyEmitted row per invocation (no duplicate)", async () => {
    const { useCase, audit } = build();
    await useCase.exportMasterKey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
    });
    const exportRows = audit.events.filter(
      (e) => e.eventType === "ExportKeyEmitted",
    );
    expect(exportRows).toHaveLength(1);
  });

  it("PrintableMasterKey.toJSON redacts so JSON.stringify never leaks the rendered form", async () => {
    const { useCase } = build();
    const output = await useCase.exportMasterKey({
      workspaceId: WorkspaceId.from(WS_ID),
      currentPassphrase: Passphrase.from("current-strong-passphrase"),
    });
    const serialised = JSON.stringify({
      printableMasterKey: output.printableMasterKey,
    });
    // The canonical rendering MUST NOT appear in the JSON dump.
    expect(serialised).not.toContain(output.printableMasterKey.toString());
    // The redaction sentinel IS in the dump.
    expect(serialised).toContain(
      PrintableMasterKey.redactedJsonRepresentation(),
    );
  });
});
