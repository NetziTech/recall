import { describe, it, expect } from "vitest";

import { secureZero } from "../../../../../src/shared/infrastructure/crypto/secure-zero.ts";

describe("secureZero", () => {
  it("fills all bytes of a populated buffer with zero", () => {
    const buf = Buffer.alloc(32, 0xff);
    expect(buf.every((byte) => byte === 0xff)).toBe(true);

    secureZero(buf);

    expect(buf).toHaveLength(32);
    expect(buf.every((byte) => byte === 0x00)).toBe(true);
  });

  it("handles empty buffer (length 0) without throwing", () => {
    const buf = Buffer.alloc(0);

    expect(() => secureZero(buf)).not.toThrow();
    expect(buf).toHaveLength(0);
  });

  it("handles already-zero buffer idempotently", () => {
    const buf = Buffer.alloc(16);
    expect(buf.every((byte) => byte === 0x00)).toBe(true);

    secureZero(buf);

    expect(buf).toHaveLength(16);
    expect(buf.every((byte) => byte === 0x00)).toBe(true);
  });

  it("handles small buffer (length 1) correctly", () => {
    const buf = Buffer.from([0xaa]);
    expect(buf[0]).toBe(0xaa);

    secureZero(buf);

    expect(buf).toHaveLength(1);
    expect(buf[0]).toBe(0x00);
  });

  it("handles boundary buffer (length 256, mixed values)", () => {
    const buf = Buffer.alloc(256);
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = i & 0xff;
    }
    expect(buf[1]).toBe(0x01);
    expect(buf[255]).toBe(0xff);

    secureZero(buf);

    expect(buf).toHaveLength(256);
    for (let i = 0; i < buf.length; i += 1) {
      expect(buf[i]).toBe(0x00);
    }
  });

  it("works with Buffer.allocUnsafeSlow (the recommended caller pattern)", () => {
    const buf = Buffer.allocUnsafeSlow(64);
    buf.fill(0xff);
    expect(buf.every((byte) => byte === 0xff)).toBe(true);

    secureZero(buf);

    expect(buf).toHaveLength(64);
    expect(buf.every((byte) => byte === 0x00)).toBe(true);
  });
});
