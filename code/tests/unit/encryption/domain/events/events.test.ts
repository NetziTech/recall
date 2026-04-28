import { describe, it, expect } from "vitest";
import { EncryptionInitialized } from "../../../../../src/modules/encryption/domain/events/encryption-initialized.ts";
import { EncryptionLocked } from "../../../../../src/modules/encryption/domain/events/encryption-locked.ts";
import { EncryptionUnlocked } from "../../../../../src/modules/encryption/domain/events/encryption-unlocked.ts";
import { EncryptionDestroyed } from "../../../../../src/modules/encryption/domain/events/encryption-destroyed.ts";
import { KeyEnvelopeAdded } from "../../../../../src/modules/encryption/domain/events/key-envelope-added.ts";
import { KeyEnvelopeRemoved } from "../../../../../src/modules/encryption/domain/events/key-envelope-removed.ts";
import { KeyValidationFailed } from "../../../../../src/modules/encryption/domain/events/key-validation-failed.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { KdfAlgorithm } from "../../../../../src/modules/encryption/domain/value-objects/kdf-algorithm.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
const ts = (): Timestamp => Timestamp.fromEpochMs(1_700_000_000_000);
const ws = (): WorkspaceId => WorkspaceId.from(WS_ID);
const key = (): KeyId => KeyId.from(KEY_ID);

describe("encryption events", () => {
  it("EncryptionInitialized payload", () => {
    const e = new EncryptionInitialized({
      workspaceId: ws(),
      kdfAlgorithm: KdfAlgorithm.argon2id(),
      firstKeyId: key(),
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("encryption.initialized");
    expect(e.workspaceId.toString()).toBe(WS_ID);
    expect(e.firstKeyId.toString()).toBe(KEY_ID);
    expect(e.kdfAlgorithm.kind).toBe("argon2id");
    expect(e.occurredAt.epochMs).toBe(1_700_000_000_000);
  });

  it("EncryptionLocked payload", () => {
    const e = new EncryptionLocked({ workspaceId: ws(), occurredAt: ts() });
    expect(e.eventName).toBe("encryption.locked");
    expect(e.workspaceId.toString()).toBe(WS_ID);
  });

  it("EncryptionUnlocked payload", () => {
    const e = new EncryptionUnlocked({
      workspaceId: ws(),
      keyId: key(),
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("encryption.unlocked");
    expect(e.keyId.toString()).toBe(KEY_ID);
  });

  it("EncryptionDestroyed payload", () => {
    const e = new EncryptionDestroyed({ workspaceId: ws(), occurredAt: ts() });
    expect(e.eventName).toBe("encryption.destroyed");
  });

  it("KeyEnvelopeAdded with label", () => {
    const e = new KeyEnvelopeAdded({
      workspaceId: ws(),
      keyId: key(),
      label: KeyLabel.create("alice"),
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("encryption.key-envelope-added");
    expect(e.label?.toString()).toBe("alice");
  });

  it("KeyEnvelopeAdded without label", () => {
    const e = new KeyEnvelopeAdded({
      workspaceId: ws(),
      keyId: key(),
      label: null,
      occurredAt: ts(),
    });
    expect(e.label).toBeNull();
  });

  it("KeyEnvelopeRemoved payload", () => {
    const e = new KeyEnvelopeRemoved({
      workspaceId: ws(),
      keyId: key(),
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("encryption.key-envelope-removed");
  });

  it("KeyValidationFailed payload", () => {
    const e = new KeyValidationFailed({
      workspaceId: ws(),
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("encryption.key-validation-failed");
    expect(e.workspaceId.toString()).toBe(WS_ID);
  });
});
