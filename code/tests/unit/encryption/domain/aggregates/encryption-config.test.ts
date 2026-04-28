import { describe, it, expect } from "vitest";
import { EncryptionConfig } from "../../../../../src/modules/encryption/domain/aggregates/encryption-config.ts";
import { KdfSpec } from "../../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { KeyEnvelope } from "../../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";
import { EncryptedMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KeyValidatorBlob } from "../../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { MasterKey } from "../../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { EncryptionNotInitializedError } from "../../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { LastEnvelopeRemovalError } from "../../../../../src/modules/encryption/domain/errors/last-envelope-removal-error.ts";
import { MasterKeyMismatchError } from "../../../../../src/modules/encryption/domain/errors/master-key-mismatch-error.ts";
import { KeyValidationFailedError } from "../../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import type { KeyValidator } from "../../../../../src/modules/encryption/domain/services/key-validator.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID_A = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
const KEY_ID_B = "01952f3d-3333-7000-8000-bbbbbbbbbbbb";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const masterKey = (fill = 0xff): MasterKey => MasterKey.from(buf(32, fill));
const ts = (epochMs: number): Timestamp => Timestamp.fromEpochMs(epochMs);
const workspaceId = (): WorkspaceId => WorkspaceId.from(WS_ID);
const validatorBlob = (): KeyValidatorBlob =>
  KeyValidatorBlob.create({
    expectedPlaintext: new TextEncoder().encode("VALID"),
    ciphertext: buf(5, 0x55),
    iv: buf(12),
    tag: buf(16),
  });

const envelope = (id: string, fill = 1, label: string | null = "alice"): KeyEnvelope =>
  KeyEnvelope.create({
    keyId: KeyId.from(id),
    encryptedMasterKey: EncryptedMasterKey.create({
      ciphertext: buf(32, fill),
      iv: buf(12, 2),
      tag: buf(16, 3),
    }),
    kdfParams: KdfParams.defaults(SaltBytes.from(buf(16, 7))),
    createdAt: ts(1_700_000_000_000),
    label: label === null ? null : KeyLabel.create(label),
  });

const kdfSpec = (): KdfSpec =>
  KdfSpec.argon2idDefaults(SaltBytes.from(buf(16, 7)));

const initializedConfig = (): EncryptionConfig =>
  EncryptionConfig.initialize({
    workspaceId: workspaceId(),
    masterKey: masterKey(),
    firstEnvelope: envelope(KEY_ID_A),
    kdfSpec: kdfSpec(),
    validatorBlob: validatorBlob(),
    occurredAt: ts(1_700_000_000_000),
  });

const acceptingValidator: KeyValidator = {
  validate: async () => Promise.resolve(true),
};
const rejectingValidator: KeyValidator = {
  validate: async () => Promise.resolve(false),
};

describe("EncryptionConfig", () => {
  describe("initialize()", () => {
    it("starts unlocked with one envelope", () => {
      const cfg = initializedConfig();
      expect(cfg.isUnlocked()).toBe(true);
      expect(cfg.envelopeCount()).toBe(1);
      expect(cfg.getWorkspaceId().toString()).toBe(WS_ID);
    });

    it("emits EncryptionInitialized", () => {
      const cfg = initializedConfig();
      const events = cfg.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]?.eventName).toBe("encryption.initialized");
    });

    it("getKdfSpec returns the spec", () => {
      const cfg = initializedConfig();
      expect(cfg.getKdfSpec().algorithm.kind).toBe("argon2id");
    });

    it("getKeyValidatorBlob returns blob", () => {
      const cfg = initializedConfig();
      expect(cfg.getKeyValidatorBlob().expectedPlaintextLength()).toBe(5);
    });

    it("getCreatedAt and getUpdatedAt", () => {
      const cfg = initializedConfig();
      expect(cfg.getCreatedAt().epochMs).toBe(1_700_000_000_000);
      expect(cfg.getUpdatedAt().epochMs).toBe(1_700_000_000_000);
    });
  });

  describe("rehydrate()", () => {
    it("starts locked even though envelopes exist", () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_001_000),
      });
      expect(cfg.isUnlocked()).toBe(false);
      expect(cfg.envelopeCount()).toBe(1);
    });

    it("emits no event", () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      expect(cfg.pullEvents().length).toBe(0);
    });

    it("rejects empty envelopes list with InvariantViolationError", () => {
      expect(() =>
        EncryptionConfig.rehydrate({
          workspaceId: workspaceId(),
          kdfSpec: kdfSpec(),
          keyValidatorBlob: validatorBlob(),
          envelopes: [],
          createdAt: ts(1_700_000_000_000),
          updatedAt: ts(1_700_000_000_000),
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe("rejectMissing()", () => {
    it("always throws EncryptionNotInitializedError", () => {
      expect(() => EncryptionConfig.rejectMissing(workspaceId())).toThrow(
        EncryptionNotInitializedError,
      );
    });
  });

  describe("addEnvelope()", () => {
    it("adds a new envelope when unlocked and master key matches", () => {
      const cfg = initializedConfig();
      cfg.pullEvents(); // drain initialized event
      cfg.addEnvelope({
        envelope: envelope(KEY_ID_B),
        unwrappedMasterKey: masterKey(),
        occurredAt: ts(1_700_000_001_000),
      });
      expect(cfg.envelopeCount()).toBe(2);
      const events = cfg.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]?.eventName).toBe("encryption.key-envelope-added");
      expect(cfg.getUpdatedAt().epochMs).toBe(1_700_000_001_000);
    });

    it("rejects when locked", () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      expect(() =>
        cfg.addEnvelope({
          envelope: envelope(KEY_ID_B),
          unwrappedMasterKey: masterKey(),
          occurredAt: ts(1_700_000_001_000),
        }),
      ).toThrow(InvariantViolationError);
    });

    it("rejects duplicate keyId", () => {
      const cfg = initializedConfig();
      expect(() =>
        cfg.addEnvelope({
          envelope: envelope(KEY_ID_A),
          unwrappedMasterKey: masterKey(),
          occurredAt: ts(1_700_000_001_000),
        }),
      ).toThrow(InvariantViolationError);
    });

    it("rejects mismatching master key", () => {
      const cfg = initializedConfig();
      expect(() =>
        cfg.addEnvelope({
          envelope: envelope(KEY_ID_B),
          unwrappedMasterKey: masterKey(0xaa),
          occurredAt: ts(1_700_000_001_000),
        }),
      ).toThrow(MasterKeyMismatchError);
    });
  });

  describe("removeEnvelope()", () => {
    it("removes a non-last envelope", () => {
      const cfg = initializedConfig();
      cfg.addEnvelope({
        envelope: envelope(KEY_ID_B),
        unwrappedMasterKey: masterKey(),
        occurredAt: ts(1_700_000_001_000),
      });
      cfg.pullEvents();
      cfg.removeEnvelope({
        keyId: KeyId.from(KEY_ID_A),
        occurredAt: ts(1_700_000_002_000),
      });
      expect(cfg.envelopeCount()).toBe(1);
      const events = cfg.pullEvents();
      expect(events[0]?.eventName).toBe("encryption.key-envelope-removed");
    });

    it("rejects removing the last envelope", () => {
      const cfg = initializedConfig();
      expect(() =>
        cfg.removeEnvelope({
          keyId: KeyId.from(KEY_ID_A),
          occurredAt: ts(1_700_000_001_000),
        }),
      ).toThrow(LastEnvelopeRemovalError);
    });

    it("rejects removing a non-existent envelope", () => {
      const cfg = initializedConfig();
      expect(() =>
        cfg.removeEnvelope({
          keyId: KeyId.from(KEY_ID_B),
          occurredAt: ts(1_700_000_001_000),
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe("unlockWith()", () => {
    it("unlocks with a valid master key", async () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      await cfg.unlockWith({
        candidate: masterKey(),
        keyId: KeyId.from(KEY_ID_A),
        validator: acceptingValidator,
        occurredAt: ts(1_700_000_001_000),
      });
      expect(cfg.isUnlocked()).toBe(true);
      const events = cfg.pullEvents();
      expect(events[0]?.eventName).toBe("encryption.unlocked");
    });

    it("rejects wrong master key", async () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      await expect(
        cfg.unlockWith({
          candidate: masterKey(),
          keyId: KeyId.from(KEY_ID_A),
          validator: rejectingValidator,
          occurredAt: ts(1_700_000_001_000),
        }),
      ).rejects.toThrow(KeyValidationFailedError);
      const events = cfg.pullEvents();
      expect(events[0]?.eventName).toBe("encryption.key-validation-failed");
      expect(cfg.isUnlocked()).toBe(false);
    });

    it("rejects unlock when already unlocked", async () => {
      const cfg = initializedConfig();
      await expect(
        cfg.unlockWith({
          candidate: masterKey(),
          keyId: KeyId.from(KEY_ID_A),
          validator: acceptingValidator,
          occurredAt: ts(1_700_000_001_000),
        }),
      ).rejects.toThrow(InvariantViolationError);
    });

    it("rejects unlock with non-existent envelope", async () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      await expect(
        cfg.unlockWith({
          candidate: masterKey(),
          keyId: KeyId.from(KEY_ID_B),
          validator: acceptingValidator,
          occurredAt: ts(1_700_000_001_000),
        }),
      ).rejects.toThrow(InvariantViolationError);
    });
  });

  describe("lock()", () => {
    it("locks an unlocked config", () => {
      const cfg = initializedConfig();
      cfg.lock({ occurredAt: ts(1_700_000_002_000) });
      expect(cfg.isUnlocked()).toBe(false);
      const events = cfg.pullEvents();
      expect(
        events.some((e) => e.eventName === "encryption.locked"),
      ).toBe(true);
    });

    it("rejects double-lock", () => {
      const cfg = initializedConfig();
      cfg.lock({ occurredAt: ts(1_700_000_001_000) });
      expect(() =>
        cfg.lock({ occurredAt: ts(1_700_000_002_000) }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe("queries", () => {
    it("hasEnvelope returns true/false", () => {
      const cfg = initializedConfig();
      expect(cfg.hasEnvelope(KeyId.from(KEY_ID_A))).toBe(true);
      expect(cfg.hasEnvelope(KeyId.from(KEY_ID_B))).toBe(false);
    });

    it("getEnvelopes returns frozen array", () => {
      const cfg = initializedConfig();
      const envs = cfg.getEnvelopes();
      expect(Object.isFrozen(envs)).toBe(true);
      expect(envs.length).toBe(1);
    });

    it("withUnlockedKey passes the master key", () => {
      const cfg = initializedConfig();
      const captured = cfg.withUnlockedKey((k) => k.length());
      expect(captured).toBe(32);
    });

    it("withUnlockedKey throws when locked", () => {
      const cfg = EncryptionConfig.rehydrate({
        workspaceId: workspaceId(),
        kdfSpec: kdfSpec(),
        keyValidatorBlob: validatorBlob(),
        envelopes: [envelope(KEY_ID_A)],
        createdAt: ts(1_700_000_000_000),
        updatedAt: ts(1_700_000_000_000),
      });
      expect(() => cfg.withUnlockedKey((k) => k.length())).toThrow(
        InvariantViolationError,
      );
    });

    it("pullEvents drains the buffer", () => {
      const cfg = initializedConfig();
      const events1 = cfg.pullEvents();
      expect(events1.length).toBe(1);
      const events2 = cfg.pullEvents();
      expect(events2.length).toBe(0);
      expect(Object.isFrozen(events2)).toBe(true);
    });
  });
});
