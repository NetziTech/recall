import { describe, it, expect } from "vitest";
import { DerivedKey } from "../../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const filled = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

describe("DerivedKey", () => {
  it("from() builds a 32-byte derived key", () => {
    const k = DerivedKey.from(filled(32, 1));
    expect(k.length()).toBe(32);
  });

  it("from() rejects wrong size", () => {
    expect(() => DerivedKey.from(filled(16))).toThrow(InvalidInputError);
    expect(() => DerivedKey.from(filled(64))).toThrow(InvalidInputError);
  });

  it("from() rejects non-Uint8Array", () => {
    expect(() =>
      DerivedKey.from([1, 2, 3] as unknown as Uint8Array),
    ).toThrow(InvalidInputError);
  });

  it("toString redacts", () => {
    const k = DerivedKey.from(filled(32, 0xff));
    expect(k.toString()).toBe("<DerivedKey:redacted>");
  });

  it("toJSON redacts", () => {
    const k = DerivedKey.from(filled(32, 0xff));
    expect(JSON.stringify(k)).toContain("DerivedKey:redacted");
  });

  it("withBytes returns a defensive copy", () => {
    const k = DerivedKey.from(filled(32, 0xab));
    k.withBytes((b) => {
      b[0] = 0;
    });
    k.withBytes((b) => {
      expect(b[0]).toBe(0xab);
    });
  });

  it("withBytes returns callback result", () => {
    const k = DerivedKey.from(filled(32, 1));
    const length = k.withBytes((b) => b.length);
    expect(length).toBe(32);
  });

  it("equals() is constant time and content-based", () => {
    const a = DerivedKey.from(filled(32, 0x33));
    const b = DerivedKey.from(filled(32, 0x33));
    const c = DerivedKey.from(filled(32, 0x44));
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("lengthBytes returns 32", () => {
    expect(DerivedKey.lengthBytes()).toBe(32);
  });

  it("redactedRepresentation returns the sentinel", () => {
    expect(DerivedKey.redactedRepresentation()).toBe("<DerivedKey:redacted>");
  });
});
