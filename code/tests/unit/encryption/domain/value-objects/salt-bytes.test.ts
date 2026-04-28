import { describe, it, expect } from "vitest";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("SaltBytes", () => {
  it("from() accepts >= 16 bytes", () => {
    const s = SaltBytes.from(new Uint8Array(16).fill(1));
    expect(s.length()).toBe(16);
  });

  it("from() accepts more than 16 bytes", () => {
    const s = SaltBytes.from(new Uint8Array(32).fill(1));
    expect(s.length()).toBe(32);
  });

  it("from() rejects < 16 bytes", () => {
    expect(() => SaltBytes.from(new Uint8Array(8))).toThrow(InvalidInputError);
  });

  it("from() rejects non-Uint8Array", () => {
    expect(() =>
      SaltBytes.from([1, 2, 3] as unknown as Uint8Array),
    ).toThrow(InvalidInputError);
  });

  it("withBytes returns defensive copy", () => {
    const original = new Uint8Array(16).fill(0x77);
    const s = SaltBytes.from(original);
    s.withBytes((b) => {
      b[0] = 0;
    });
    s.withBytes((b) => {
      expect(b[0]).toBe(0x77);
    });
    // Mutating source after creation does not affect VO.
    original[0] = 0;
    s.withBytes((b) => {
      expect(b[0]).toBe(0x77);
    });
  });

  it("withBytes returns callback result", () => {
    const s = SaltBytes.from(new Uint8Array(16).fill(2));
    const sum = s.withBytes((b) => b.reduce((a, v) => a + v, 0));
    expect(sum).toBe(32);
  });

  it("equals() identity", () => {
    const s = SaltBytes.from(new Uint8Array(16).fill(3));
    expect(s.equals(s)).toBe(true);
  });

  it("equals() content match", () => {
    const a = SaltBytes.from(new Uint8Array(16).fill(3));
    const b = SaltBytes.from(new Uint8Array(16).fill(3));
    expect(a.equals(b)).toBe(true);
  });

  it("equals() differing content", () => {
    const a = SaltBytes.from(new Uint8Array(16).fill(3));
    const b = SaltBytes.from(new Uint8Array(16).fill(4));
    expect(a.equals(b)).toBe(false);
  });

  it("equals() differing length", () => {
    const a = SaltBytes.from(new Uint8Array(16).fill(3));
    const b = SaltBytes.from(new Uint8Array(32).fill(3));
    expect(a.equals(b)).toBe(false);
  });

  it("minLengthBytes returns 16", () => {
    expect(SaltBytes.minLengthBytes()).toBe(16);
  });
});
