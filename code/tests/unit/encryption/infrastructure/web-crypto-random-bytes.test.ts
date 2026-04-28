import { describe, it, expect } from "vitest";
import { WebCryptoRandomBytes } from "../../../../src/modules/encryption/infrastructure/random/web-crypto-random-bytes.ts";
import { RandomBytesError } from "../../../../src/modules/encryption/infrastructure/errors/random-bytes-error.ts";

describe("WebCryptoRandomBytes", () => {
  const adapter = new WebCryptoRandomBytes();

  it("returns a Uint8Array of the requested length", () => {
    const buf = adapter.next(32);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBe(32);
  });

  it("produces non-deterministic output (entropy check)", () => {
    const a = adapter.next(32);
    const b = adapter.next(32);
    // Probability of two random 32-byte buffers being equal is ~2^-256
    const equal = a.every((v, i) => v === b[i]);
    expect(equal).toBe(false);
  });

  it("produces different IVs and salts on each call", () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      ivs.add(Buffer.from(adapter.next(12)).toString("hex"));
    }
    expect(ivs.size).toBe(10);
  });

  it("rejects zero-length", () => {
    expect(() => adapter.next(0)).toThrow(RandomBytesError);
  });

  it("rejects negative length", () => {
    expect(() => adapter.next(-1)).toThrow(RandomBytesError);
  });

  it("rejects non-integer length", () => {
    expect(() => adapter.next(3.14)).toThrow(RandomBytesError);
  });

  it("rejects Infinity", () => {
    expect(() => adapter.next(Infinity)).toThrow(RandomBytesError);
  });

  it("rejects NaN", () => {
    expect(() => adapter.next(NaN)).toThrow(RandomBytesError);
  });

  it("rejects oversized length", () => {
    expect(() => adapter.next(70_000)).toThrow(RandomBytesError);
  });

  it("accepts exactly the max", () => {
    const buf = adapter.next(65_536);
    expect(buf.length).toBe(65_536);
  });
});
