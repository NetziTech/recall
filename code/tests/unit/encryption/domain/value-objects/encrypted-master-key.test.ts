import { describe, it, expect } from "vitest";
import { EncryptedMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

describe("EncryptedMasterKey", () => {
  it("create() builds with valid buffers", () => {
    const e = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    expect(e.ciphertextLength()).toBe(32);
    expect(e.ivLength()).toBe(12);
    expect(e.tagLength()).toBe(16);
  });

  it("rejects iv shorter than 12 bytes", () => {
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(32),
        iv: buf(8),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects tag of wrong length", () => {
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(32),
        iv: buf(12),
        tag: buf(15),
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(32),
        iv: buf(12),
        tag: buf(17),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty ciphertext", () => {
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(0),
        iv: buf(12),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-Uint8Array buffers", () => {
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: [1, 2] as unknown as Uint8Array,
        iv: buf(12),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(32),
        iv: [1] as unknown as Uint8Array,
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EncryptedMasterKey.create({
        ciphertext: buf(32),
        iv: buf(12),
        tag: "tag" as unknown as Uint8Array,
      }),
    ).toThrow(InvalidInputError);
  });

  it("withCiphertext returns defensive copy", () => {
    const e = EncryptedMasterKey.create({
      ciphertext: buf(32, 0xab),
      iv: buf(12),
      tag: buf(16),
    });
    e.withCiphertext((c) => {
      c[0] = 0;
    });
    e.withCiphertext((c) => {
      expect(c[0]).toBe(0xab);
    });
  });

  it("withIv returns defensive copy", () => {
    const e = EncryptedMasterKey.create({
      ciphertext: buf(32),
      iv: buf(12, 0xcc),
      tag: buf(16),
    });
    e.withIv((iv) => {
      iv[0] = 0;
    });
    e.withIv((iv) => {
      expect(iv[0]).toBe(0xcc);
    });
  });

  it("withTag returns defensive copy", () => {
    const e = EncryptedMasterKey.create({
      ciphertext: buf(32),
      iv: buf(12),
      tag: buf(16, 0xdd),
    });
    e.withTag((t) => {
      t[0] = 0;
    });
    e.withTag((t) => {
      expect(t[0]).toBe(0xdd);
    });
  });

  it("equals() identity", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    expect(a.equals(a)).toBe(true);
  });

  it("equals() content match", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    const b = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    expect(a.equals(b)).toBe(true);
  });

  it("equals() different ciphertext", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    const b = EncryptedMasterKey.create({
      ciphertext: buf(32, 0xff),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() different iv", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    const b = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 0xff),
      tag: buf(16, 3),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() different tag", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    const b = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 0xff),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing lengths return false", () => {
    const a = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    const b = EncryptedMasterKey.create({
      ciphertext: buf(64, 1),
      iv: buf(12, 2),
      tag: buf(16, 3),
    });
    expect(a.equals(b)).toBe(false);

    const c = EncryptedMasterKey.create({
      ciphertext: buf(32, 1),
      iv: buf(16, 2),
      tag: buf(16, 3),
    });
    expect(a.equals(c)).toBe(false);
  });

  it("static helpers expose constants", () => {
    expect(EncryptedMasterKey.tagLengthBytes()).toBe(16);
    expect(EncryptedMasterKey.minIvLengthBytes()).toBe(12);
  });
});
