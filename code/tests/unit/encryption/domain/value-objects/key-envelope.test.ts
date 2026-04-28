import { describe, it, expect } from "vitest";
import { KeyEnvelope } from "../../../../../src/modules/encryption/domain/value-objects/key-envelope.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";
import { EncryptedMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";

const ID_A = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const ID_B = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

const makeEnvelope = (overrides?: {
  keyId?: KeyId;
  label?: KeyLabel | null;
  cipherFill?: number;
}): KeyEnvelope =>
  KeyEnvelope.create({
    keyId: overrides?.keyId ?? KeyId.from(ID_A),
    encryptedMasterKey: EncryptedMasterKey.create({
      ciphertext: buf(32, overrides?.cipherFill ?? 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    }),
    kdfParams: KdfParams.defaults(SaltBytes.from(buf(16, 7))),
    createdAt: Timestamp.fromEpochMs(1_700_000_000_000),
    label: overrides?.label === undefined ? KeyLabel.create("alice") : overrides.label,
  });

describe("KeyEnvelope", () => {
  it("create() builds an envelope", () => {
    const env = makeEnvelope();
    expect(env.keyId.toString()).toBe(ID_A);
    expect(env.label?.toString()).toBe("alice");
  });

  it("withLabel() returns same instance when both labels null", () => {
    const env = makeEnvelope({ label: null });
    const same = env.withLabel(null);
    expect(same).toBe(env);
  });

  it("withLabel() returns same instance when labels equal", () => {
    const env = makeEnvelope({ label: KeyLabel.create("alice") });
    const same = env.withLabel(KeyLabel.create("alice"));
    expect(same).toBe(env);
  });

  it("withLabel() replaces label when changed", () => {
    const env = makeEnvelope({ label: KeyLabel.create("alice") });
    const renamed = env.withLabel(KeyLabel.create("bob"));
    expect(renamed.label?.toString()).toBe("bob");
    expect(renamed).not.toBe(env);
  });

  it("withLabel() handles label going null -> non-null", () => {
    const env = makeEnvelope({ label: null });
    const labeled = env.withLabel(KeyLabel.create("new"));
    expect(labeled.label?.toString()).toBe("new");
  });

  it("withLabel() handles label going non-null -> null", () => {
    const env = makeEnvelope({ label: KeyLabel.create("alice") });
    const cleared = env.withLabel(null);
    expect(cleared.label).toBeNull();
  });

  it("equals() based on keyId only", () => {
    const a = makeEnvelope({ keyId: KeyId.from(ID_A), cipherFill: 1 });
    const b = makeEnvelope({ keyId: KeyId.from(ID_A), cipherFill: 99 });
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals() returns false for different keyId", () => {
    const a = makeEnvelope({ keyId: KeyId.from(ID_A) });
    const b = makeEnvelope({ keyId: KeyId.from(ID_B) });
    expect(a.equals(b)).toBe(false);
  });

  it("deepEquals() compares all fields", () => {
    const a = makeEnvelope();
    const b = makeEnvelope();
    expect(a.deepEquals(a)).toBe(true);
    expect(a.deepEquals(b)).toBe(true);
  });

  it("deepEquals() returns false for different keyId", () => {
    const a = makeEnvelope({ keyId: KeyId.from(ID_A) });
    const b = makeEnvelope({ keyId: KeyId.from(ID_B) });
    expect(a.deepEquals(b)).toBe(false);
  });

  it("deepEquals() returns false for different cipher", () => {
    const a = makeEnvelope({ cipherFill: 1 });
    const b = makeEnvelope({ cipherFill: 99 });
    expect(a.deepEquals(b)).toBe(false);
  });

  it("deepEquals() returns false when one label null and one not", () => {
    const a = makeEnvelope({ label: null });
    const b = makeEnvelope({ label: KeyLabel.create("alice") });
    expect(a.deepEquals(b)).toBe(false);
    expect(b.deepEquals(a)).toBe(false);
  });

  it("deepEquals() returns true when both labels null and rest equal", () => {
    const a = makeEnvelope({ label: null });
    const b = makeEnvelope({ label: null });
    expect(a.deepEquals(b)).toBe(true);
  });

  it("deepEquals() returns false on differing labels (both non-null)", () => {
    const a = makeEnvelope({ label: KeyLabel.create("alice") });
    const b = makeEnvelope({ label: KeyLabel.create("bob") });
    expect(a.deepEquals(b)).toBe(false);
  });

  it("deepEquals() returns false on differing kdfParams", () => {
    const env = makeEnvelope();
    const otherParams = KdfParams.defaults(SaltBytes.from(buf(16, 0xaa)));
    const otherEnv = KeyEnvelope.create({
      keyId: KeyId.from(ID_A),
      encryptedMasterKey: EncryptedMasterKey.create({
        ciphertext: buf(32, 1),
        iv: buf(12, 2),
        tag: buf(16, 3),
      }),
      kdfParams: otherParams,
      createdAt: Timestamp.fromEpochMs(1_700_000_000_000),
      label: KeyLabel.create("alice"),
    });
    expect(env.deepEquals(otherEnv)).toBe(false);
  });

  it("deepEquals() returns false on differing createdAt", () => {
    const a = makeEnvelope();
    const b = KeyEnvelope.create({
      keyId: KeyId.from(ID_A),
      encryptedMasterKey: EncryptedMasterKey.create({
        ciphertext: buf(32, 1),
        iv: buf(12, 2),
        tag: buf(16, 3),
      }),
      kdfParams: KdfParams.defaults(SaltBytes.from(buf(16, 7))),
      createdAt: Timestamp.fromEpochMs(2_000_000_000_000),
      label: KeyLabel.create("alice"),
    });
    expect(a.deepEquals(b)).toBe(false);
  });
});
