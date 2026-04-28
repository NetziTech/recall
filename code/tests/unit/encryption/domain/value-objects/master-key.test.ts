import { describe, it, expect } from "vitest";
import { MasterKey } from "../../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const filledBytes = (n: number, value = 0): Uint8Array => {
  const buf = new Uint8Array(n);
  buf.fill(value);
  return buf;
};

describe("MasterKey", () => {
  describe("from()", () => {
    it("builds a 32-byte key", () => {
      const key = MasterKey.from(filledBytes(32, 1));
      expect(key.length()).toBe(32);
    });

    it("rejects keys shorter than 32 bytes", () => {
      expect(() => MasterKey.from(filledBytes(16))).toThrow(InvalidInputError);
    });

    it("rejects keys longer than 32 bytes", () => {
      expect(() => MasterKey.from(filledBytes(64))).toThrow(InvalidInputError);
    });

    it("rejects non-Uint8Array input", () => {
      expect(() =>
        MasterKey.from([1, 2, 3] as unknown as Uint8Array),
      ).toThrow(InvalidInputError);
    });

    it("defensive copy: mutating the source after construction does not affect the VO", () => {
      const source = filledBytes(32, 0xab);
      const key = MasterKey.from(source);
      source.fill(0);
      key.withBytes((bytes) => {
        for (let i = 0; i < 32; i += 1) {
          expect(bytes[i]).toBe(0xab);
        }
      });
    });
  });

  describe("redaction", () => {
    it("toString returns the redacted sentinel", () => {
      const key = MasterKey.from(filledBytes(32, 0xff));
      expect(key.toString()).toBe("<MasterKey:redacted>");
    });

    it("toJSON returns the redacted sentinel", () => {
      const key = MasterKey.from(filledBytes(32, 0xff));
      expect(JSON.stringify(key)).toContain("MasterKey:redacted");
    });

    it("template literal interpolation never exposes bytes", () => {
      const key = MasterKey.from(filledBytes(32, 0x42));
      const out = `key=${String(key)}`;
      expect(out).toContain("redacted");
      expect(out).not.toMatch(/[0-9a-f]{8}/i);
    });
  });

  describe("withBytes()", () => {
    it("provides a defensive copy", () => {
      const key = MasterKey.from(filledBytes(32, 0xab));
      let firstCopyAddress: Uint8Array | undefined;
      key.withBytes((b) => {
        firstCopyAddress = b;
        b[0] = 0; // mutate copy
      });
      key.withBytes((b) => {
        expect(b[0]).toBe(0xab);
        expect(b).not.toBe(firstCopyAddress);
      });
    });

    it("returns the callback result", () => {
      const key = MasterKey.from(filledBytes(32, 0x10));
      const sum = key.withBytes((b) => b.reduce((acc, v) => acc + v, 0));
      expect(sum).toBe(32 * 0x10);
    });
  });

  describe("equals() — constant time", () => {
    it("returns true for same instance", () => {
      const a = MasterKey.from(filledBytes(32, 0x55));
      expect(a.equals(a)).toBe(true);
    });

    it("returns true for byte-equal keys", () => {
      const a = MasterKey.from(filledBytes(32, 0x55));
      const b = MasterKey.from(filledBytes(32, 0x55));
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for byte-different keys", () => {
      const a = MasterKey.from(filledBytes(32, 0x55));
      const b = MasterKey.from(filledBytes(32, 0xaa));
      expect(a.equals(b)).toBe(false);
    });
  });

  describe("static helpers", () => {
    it("lengthBytes returns 32", () => {
      expect(MasterKey.lengthBytes()).toBe(32);
    });

    it("redactedRepresentation returns the sentinel", () => {
      expect(MasterKey.redactedRepresentation()).toBe("<MasterKey:redacted>");
    });
  });
});
