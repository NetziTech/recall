import { describe, it, expect } from "vitest";
import { Passphrase } from "../../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("Passphrase", () => {
  describe("from()", () => {
    it("builds a passphrase with at least the minimum length", () => {
      const passphrase = Passphrase.from("a-strong-passphrase");
      expect(passphrase.length()).toBe("a-strong-passphrase".length);
    });

    it("trims leading/trailing whitespace", () => {
      const p = Passphrase.from("  valid-passphrase  ");
      expect(p.length()).toBe("valid-passphrase".length);
    });

    it("rejects strings shorter than 12 characters", () => {
      expect(() => Passphrase.from("short")).toThrow(InvalidInputError);
    });

    it("rejects empty string", () => {
      expect(() => Passphrase.from("")).toThrow(InvalidInputError);
    });

    it("rejects whitespace-only string", () => {
      expect(() => Passphrase.from("            ")).toThrow(InvalidInputError);
    });

    it("rejects non-string input", () => {
      expect(() => Passphrase.from(123 as unknown as string)).toThrow(
        InvalidInputError,
      );
    });

    it("error message references the configured min length", () => {
      try {
        Passphrase.from("ab");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError);
        expect((err as Error).message).toContain("12");
      }
    });
  });

  describe("redaction", () => {
    it("toString returns the redacted sentinel, not the chars", () => {
      const p = Passphrase.from("super-secret-passphrase-123");
      expect(p.toString()).toBe(Passphrase.redactedRepresentation());
      expect(p.toString()).not.toContain("super-secret");
    });

    it("toJSON returns the redacted sentinel", () => {
      const p = Passphrase.from("super-secret-passphrase-123");
      expect(JSON.stringify(p)).toContain("Passphrase:redacted");
      expect(JSON.stringify(p)).not.toContain("super-secret");
    });

    it("template literal interpolation does NOT expose the chars", () => {
      const p = Passphrase.from("super-secret-passphrase-123");
      const interpolated = `pp=${String(p)}`;
      expect(interpolated).not.toContain("super-secret");
    });
  });

  describe("withChars()", () => {
    it("delivers the trimmed chars to the callback", () => {
      const p = Passphrase.from("  trimmed-passphrase  ");
      let captured = "";
      p.withChars((c) => {
        captured = c;
      });
      expect(captured).toBe("trimmed-passphrase");
    });

    it("returns the callback result", () => {
      const p = Passphrase.from("a-valid-passphrase");
      const result = p.withChars((chars) => chars.length);
      expect(result).toBe("a-valid-passphrase".length);
    });
  });

  describe("equals() — constant time", () => {
    it("returns true for the same instance", () => {
      const p = Passphrase.from("identical-passphrase");
      expect(p.equals(p)).toBe(true);
    });

    it("returns true for two instances with same content", () => {
      const a = Passphrase.from("identical-passphrase");
      const b = Passphrase.from("identical-passphrase");
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for different content", () => {
      const a = Passphrase.from("first-passphrase");
      const b = Passphrase.from("second-passphrase");
      expect(a.equals(b)).toBe(false);
    });

    it("returns false for different lengths", () => {
      const a = Passphrase.from("short-passphrase");
      const b = Passphrase.from("longer-passphrase-here");
      expect(a.equals(b)).toBe(false);
    });
  });

  describe("static helpers", () => {
    it("minLength exposes 12", () => {
      expect(Passphrase.minLength()).toBe(12);
    });

    it("redactedRepresentation exposes the sentinel", () => {
      expect(Passphrase.redactedRepresentation()).toBe("<Passphrase:redacted>");
    });
  });
});
