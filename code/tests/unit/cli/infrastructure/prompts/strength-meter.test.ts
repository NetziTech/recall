import * as crypto from "node:crypto";

import { describe, it, expect } from "vitest";

import { CliInfrastructureError } from "../../../../../src/modules/cli/infrastructure/errors/cli-infrastructure-error.ts";
import {
  assertStrongPassphrase,
  shannonBits,
} from "../../../../../src/modules/cli/infrastructure/prompts/strength-meter.ts";

describe("shannonBits — fixed vectors", () => {
  it("returns 0 for an empty buffer", () => {
    expect(shannonBits(Buffer.alloc(0))).toBe(0);
  });

  it("returns 0 for a buffer with a single symbol repeated (no information)", () => {
    // Constant byte stream: H(X) = 0 because p(0x61) = 1, log2(1) = 0.
    const buf = Buffer.from("a".repeat(100), "utf8");
    expect(shannonBits(buf)).toBe(0);
  });

  it("returns exactly N bits for a uniform two-symbol stream of length N", () => {
    // Alternating 0x00 / 0x01 → 50/50 distribution → H(X) = 1 bit per
    // symbol → total = length bits exactly.
    const len = 32;
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      buf[i] = i % 2;
    }
    expect(shannonBits(buf)).toBeCloseTo(len, 9);
  });

  it("returns ~8*N bits for cryptographically uniform random bytes of length N", () => {
    // For N=4096, sample variance is small; empirically H(X) should
    // sit within ~0.5% of 8 bits per byte. We assert a generous
    // tolerance to stay deterministic across runs.
    const len = 4096;
    const buf = crypto.randomBytes(len);
    const bits = shannonBits(buf);
    expect(bits).toBeGreaterThan(8 * len * 0.99);
    expect(bits).toBeLessThanOrEqual(8 * len);
  });

  it("is additive: 2*N bytes of the same uniform distribution yields 2x the entropy of N bytes", () => {
    // Sanity check that the formula multiplies H(X) by length, not by
    // sqrt(length) or any other miscount.
    const half = Buffer.alloc(16);
    const full = Buffer.alloc(32);
    for (let i = 0; i < 16; i++) {
      half[i] = i % 2;
      full[i] = i % 2;
      full[i + 16] = i % 2;
    }
    expect(shannonBits(full)).toBeCloseTo(shannonBits(half) * 2, 9);
  });
});

describe("assertStrongPassphrase — length floor", () => {
  it("throws cli.weak-passphrase when the entry is below 12 characters", () => {
    // 11 random alphanum chars: byte entropy ~66 bits (above the
    // 60-bit floor), but length floor MUST fire first.
    const buf = Buffer.from("aB3cD4eF5gH", "utf8");
    expect(buf.toString("utf8").length).toBe(11);
    let captured: unknown = null;
    try {
      assertStrongPassphrase(buf);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CliInfrastructureError);
    expect((captured as CliInfrastructureError).code).toBe(
      "cli.weak-passphrase",
    );
    expect((captured as Error).message).toContain("minimo");
    expect((captured as Error).message).toContain("12");
  });

  it("throws even for a 3-char short input", () => {
    expect(() => assertStrongPassphrase(Buffer.from("123", "utf8"))).toThrow(
      CliInfrastructureError,
    );
  });

  it("accepts inputs at the 12-char floor if Shannon entropy clears the bar (custom lower bits)", () => {
    // The default 60-bit Shannon floor is mathematically unreachable
    // by a 12-char passphrase over ANY byte alphabet — Shannon is
    // bounded above by N × log2(N) when every byte is distinct, i.e.
    // 12 × log2(12) ≈ 43 bits. So "exactly 12 chars + default 60-bit
    // floor" is by-design rejected; this is the gate that pushes
    // diceware-style passphrases past 4 words. We assert the
    // length-floor boundary by lowering the entropy floor to 20 bits
    // (well below the achievable maximum for 12 chars).
    const slice = "Abc123XyZ987"; // 12 chars, 10 distinct symbols.
    expect(slice.length).toBe(12);
    // Empirical Shannon: 10 distinct symbols across 12 positions ≈
    // 12 × 3.25 = 39 bits, well above the 20-bit override.
    expect(() => assertStrongPassphrase(Buffer.from(slice, "utf8"), 20)).not.toThrow();
  });

  it("default 60-bit floor is unreachable at 12 chars (documents the design choice)", () => {
    // Even with a 256-symbol alphabet (raw random bytes), the
    // maximum Shannon at 12 bytes is 12 × log2(12) ≈ 43 bits. So
    // ANY 12-byte input is rejected by the default 60-bit floor.
    // This is intentional per ADR-005 Q5 (the length floor and
    // entropy floor act as orthogonal gates that together force
    // diceware-style passphrases ≥ 16 chars or 5+ words).
    const buf = crypto.randomBytes(12);
    expect(() => assertStrongPassphrase(buf)).toThrow(CliInfrastructureError);
  });
});

describe("assertStrongPassphrase — entropy floor", () => {
  it("throws cli.weak-passphrase when entropy is below the default 60-bit floor", () => {
    // 60 repetitions of the same character: length is way above 12
    // but Shannon entropy is 0 → must reject.
    const buf = Buffer.from("a".repeat(60), "utf8");
    let captured: unknown = null;
    try {
      assertStrongPassphrase(buf);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CliInfrastructureError);
    expect((captured as CliInfrastructureError).code).toBe(
      "cli.weak-passphrase",
    );
    expect((captured as Error).message).toContain("entropia");
    expect((captured as Error).message).toContain("60");
  });

  it("accepts a 16-byte cryptographic-random passphrase", () => {
    // 16 bytes of uniform randomness ≈ 128 bits → comfortably above
    // the 60-bit floor and the 12-char length floor.
    const buf = Buffer.from(crypto.randomBytes(16).toString("hex"), "utf8");
    expect(buf.toString("utf8").length).toBeGreaterThanOrEqual(12);
    expect(() => assertStrongPassphrase(buf)).not.toThrow();
  });

  it("honours a custom minBits override (lower floor admits a weaker entry)", () => {
    // 12 chars of a 4-symbol alphabet → H(X) = 2 bits/byte, total ~24
    // bits. Rejected by the default 60-bit floor, accepted by a
    // 20-bit override.
    const buf = Buffer.from("abcdabcdabcd", "utf8");
    expect(() => assertStrongPassphrase(buf)).toThrow(CliInfrastructureError);
    expect(() => assertStrongPassphrase(buf, 20)).not.toThrow();
  });

  it("honours a custom minBits override (higher floor rejects an otherwise OK entry)", () => {
    // 16 bytes hex → 128 bits Shannon entropy on uniform random. A
    // 200-bit override should reject it for length reasons (only
    // 32 chars × log2(16) = 128 bits achievable).
    const buf = Buffer.from(crypto.randomBytes(16).toString("hex"), "utf8");
    expect(() => assertStrongPassphrase(buf, 200)).toThrow(
      CliInfrastructureError,
    );
  });
});

describe("assertStrongPassphrase — message hygiene", () => {
  it("error messages do not echo the passphrase content", () => {
    const secret = "tequierobastantemucho";
    const buf = Buffer.from(secret, "utf8");
    try {
      assertStrongPassphrase(buf, 200); // force a failure via the entropy gate
      expect.fail("expected assertStrongPassphrase to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
