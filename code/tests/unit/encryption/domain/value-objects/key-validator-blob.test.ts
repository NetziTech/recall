import { describe, it, expect } from "vitest";
import { KeyValidatorBlob } from "../../../../../src/modules/encryption/domain/value-objects/key-validator-blob.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

describe("KeyValidatorBlob", () => {
  const valid = (): KeyValidatorBlob =>
    KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 0x55),
      iv: buf(12),
      tag: buf(16),
    });

  it("create() builds with valid inputs", () => {
    const v = valid();
    expect(v.expectedPlaintextLength()).toBe(5);
    expect(v.ciphertextLength()).toBe(5);
    expect(v.ivLength()).toBe(12);
    expect(v.tagLength()).toBe(16);
  });

  it("rejects empty expectedPlaintext", () => {
    expect(() =>
      KeyValidatorBlob.create({
        expectedPlaintext: buf(0),
        ciphertext: buf(0),
        iv: buf(12),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects iv too short", () => {
    expect(() =>
      KeyValidatorBlob.create({
        expectedPlaintext: buf(5, 1),
        ciphertext: buf(5, 1),
        iv: buf(8),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects tag wrong length", () => {
    expect(() =>
      KeyValidatorBlob.create({
        expectedPlaintext: buf(5, 1),
        ciphertext: buf(5, 1),
        iv: buf(12),
        tag: buf(15),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects ciphertext length != plaintext length", () => {
    expect(() =>
      KeyValidatorBlob.create({
        expectedPlaintext: buf(5, 1),
        ciphertext: buf(6, 1),
        iv: buf(12),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-Uint8Array fields", () => {
    expect(() =>
      KeyValidatorBlob.create({
        expectedPlaintext: "VALID" as unknown as Uint8Array,
        ciphertext: buf(5),
        iv: buf(12),
        tag: buf(16),
      }),
    ).toThrow(InvalidInputError);
  });

  it("matches() returns true for the right plaintext", () => {
    const v = valid();
    expect(v.matches(new TextEncoder().encode("VALID"))).toBe(true);
  });

  it("matches() returns false for wrong plaintext", () => {
    const v = valid();
    expect(v.matches(new TextEncoder().encode("WRONG"))).toBe(false);
  });

  it("matches() returns false for length mismatch", () => {
    const v = valid();
    expect(v.matches(new TextEncoder().encode("VALIDX"))).toBe(false);
    expect(v.matches(new TextEncoder().encode("VALI"))).toBe(false);
  });

  it("matches() returns false for non-Uint8Array", () => {
    const v = valid();
    expect(v.matches("VALID" as unknown as Uint8Array)).toBe(false);
  });

  it("withCiphertext / withIv / withTag / withExpectedPlaintext return defensive copies", () => {
    const v = valid();
    v.withCiphertext((c) => {
      c[0] = 0;
    });
    v.withCiphertext((c) => {
      expect(c[0]).toBe(0x55);
    });
    v.withIv((i) => {
      i[0] = 0xff;
    });
    v.withIv((i) => {
      expect(i[0]).toBe(0);
    });
    v.withTag((t) => {
      t[0] = 0xff;
    });
    v.withTag((t) => {
      expect(t[0]).toBe(0);
    });
    v.withExpectedPlaintext((p) => {
      p[0] = 0;
    });
    v.withExpectedPlaintext((p) => {
      expect(p[0]).toBe(0x56); // 'V'
    });
  });

  it("equals() identity & content", () => {
    const a = valid();
    const b = valid();
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals() differing plaintext content", () => {
    const a = valid();
    const b = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("OTHER"),
      ciphertext: buf(5, 0x55),
      iv: buf(12),
      tag: buf(16),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing cipher content", () => {
    const a = valid();
    const b = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 0xaa),
      iv: buf(12),
      tag: buf(16),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing iv", () => {
    const a = valid();
    const b = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 0x55),
      iv: buf(12, 1),
      tag: buf(16),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing tag", () => {
    const a = valid();
    const b = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 0x55),
      iv: buf(12),
      tag: buf(16, 1),
    });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing lengths return false", () => {
    const a = valid();
    const b = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALIDLONG"),
      ciphertext: buf(9, 0x55),
      iv: buf(12),
      tag: buf(16),
    });
    expect(a.equals(b)).toBe(false);

    const c = KeyValidatorBlob.create({
      expectedPlaintext: new TextEncoder().encode("VALID"),
      ciphertext: buf(5, 0x55),
      iv: buf(16),
      tag: buf(16),
    });
    expect(a.equals(c)).toBe(false);
  });
});
