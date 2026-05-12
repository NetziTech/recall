/**
 * Unit tests for `MasterKeyFingerprint`.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Coverage:
 *   - Vector tests with known SHA-256 prefixes (32 bytes of `0x00`
 *     and 32 bytes of `0xff`) to nail down the algorithm.
 *   - Shape invariants (16 lowercase hex chars).
 *   - Defensive copy at construction (caller can mutate input
 *     without affecting the VO).
 *   - `equals` symmetry / reflexivity / inequality.
 *   - `toString` / `toJSON` redaction sentinels (the fingerprint is
 *     local-only and MUST NOT leak via template literals or
 *     `JSON.stringify`).
 *   - Rejected inputs (wrong type, wrong length, wrong hex shape).
 */
import { describe, it, expect } from "vitest";

import { MasterKeyFingerprint } from "../../../../../src/modules/encryption/domain/value-objects/master-key-fingerprint.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

// Pre-computed SHA-256 prefixes for canonical inputs.
//   echo -n "<32 bytes of 0x00>" | sha256sum → 66687aad... (full hash)
//   first 8 bytes → 66687aadf862bd77
const ZERO_KEY_PREFIX = "66687aadf862bd77";
const FF_KEY_PREFIX = "af9613760f72635f";

describe("MasterKeyFingerprint.fromMasterKey — known vectors", () => {
  it("produces the expected prefix for 32 bytes of 0x00", () => {
    const key = new Uint8Array(32); // initialised to 0x00 by spec
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    expect(fp.toHex()).toBe(ZERO_KEY_PREFIX);
  });

  it("produces the expected prefix for 32 bytes of 0xff", () => {
    const key = new Uint8Array(32);
    key.fill(0xff);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    expect(fp.toHex()).toBe(FF_KEY_PREFIX);
  });

  it("returns exactly 16 lowercase hex characters", () => {
    const key = new Uint8Array(32);
    key.fill(0x42);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    const hex = fp.toHex();
    expect(hex.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(hex)).toBe(true);
  });

  it("produces different hex strings for unrelated random keys", () => {
    const keys: MasterKeyFingerprint[] = [];
    for (let i = 0; i < 8; i += 1) {
      const k = new Uint8Array(32);
      // Each byte = i + position so each key is distinct and not
      // structurally similar to the others.
      for (let j = 0; j < 32; j += 1) k[j] = (i * 31 + j) & 0xff;
      keys.push(MasterKeyFingerprint.fromMasterKey(k));
    }
    const hexes = keys.map((fp) => fp.toHex());
    const unique = new Set(hexes);
    // Eight distinct inputs → eight distinct 64-bit fingerprints
    // (collision probability is ~zero at this scale).
    expect(unique.size).toBe(8);
  });

  it("is stable: same input → same fingerprint", () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) key[i] = i;
    const a = MasterKeyFingerprint.fromMasterKey(key);
    const b = MasterKeyFingerprint.fromMasterKey(key);
    expect(a.toHex()).toBe(b.toHex());
  });

  it("defensive copy: mutating the caller's buffer after construction does not change the fingerprint", () => {
    const key = new Uint8Array(32);
    key.fill(0x00);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    const before = fp.toHex();
    // Mutate AFTER construction.
    key.fill(0xff);
    expect(fp.toHex()).toBe(before);
    // And the post-mutation result for a fresh call differs.
    const fpAfter = MasterKeyFingerprint.fromMasterKey(key);
    expect(fpAfter.toHex()).not.toBe(before);
  });
});

describe("MasterKeyFingerprint.fromMasterKey — input validation", () => {
  it("rejects a non-Uint8Array input", () => {
    expect(() =>
      // Deliberately bad input — cast through unknown to bypass the
      // compile-time signature for the runtime guard.
      MasterKeyFingerprint.fromMasterKey(
        "not-a-buffer" as unknown as Uint8Array,
      ),
    ).toThrow(InvalidInputError);
  });

  it("rejects a Uint8Array shorter than 32 bytes", () => {
    expect(() => MasterKeyFingerprint.fromMasterKey(new Uint8Array(16))).toThrow(
      InvalidInputError,
    );
  });

  it("rejects a Uint8Array longer than 32 bytes", () => {
    expect(() => MasterKeyFingerprint.fromMasterKey(new Uint8Array(64))).toThrow(
      InvalidInputError,
    );
  });
});

describe("MasterKeyFingerprint.fromHex", () => {
  it("accepts the canonical lowercase-hex form", () => {
    const fp = MasterKeyFingerprint.fromHex(ZERO_KEY_PREFIX);
    expect(fp.toHex()).toBe(ZERO_KEY_PREFIX);
  });

  it("rejects uppercase hex", () => {
    expect(() =>
      MasterKeyFingerprint.fromHex(ZERO_KEY_PREFIX.toUpperCase()),
    ).toThrow(InvalidInputError);
  });

  it("rejects shorter / longer / non-hex strings", () => {
    expect(() => MasterKeyFingerprint.fromHex("")).toThrow(InvalidInputError);
    expect(() => MasterKeyFingerprint.fromHex("deadbeef")).toThrow(
      InvalidInputError,
    );
    expect(() =>
      MasterKeyFingerprint.fromHex("zzzzzzzzzzzzzzzz"),
    ).toThrow(InvalidInputError);
    expect(() =>
      MasterKeyFingerprint.fromHex("0123456789abcdef0"),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string inputs", () => {
    expect(() =>
      MasterKeyFingerprint.fromHex(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("MasterKeyFingerprint.equals", () => {
  it("is reflexive", () => {
    const k = new Uint8Array(32);
    const fp = MasterKeyFingerprint.fromMasterKey(k);
    expect(fp.equals(fp)).toBe(true);
  });

  it("is symmetric for the same key bytes", () => {
    const k = new Uint8Array(32);
    k.fill(0x11);
    const a = MasterKeyFingerprint.fromMasterKey(k);
    const b = MasterKeyFingerprint.fromMasterKey(k);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(a)).toBe(true);
  });

  it("returns false for fingerprints of different keys", () => {
    const k1 = new Uint8Array(32);
    const k2 = new Uint8Array(32);
    k2.fill(0xff);
    const a = MasterKeyFingerprint.fromMasterKey(k1);
    const b = MasterKeyFingerprint.fromMasterKey(k2);
    expect(a.equals(b)).toBe(false);
    expect(b.equals(a)).toBe(false);
  });
});

describe("MasterKeyFingerprint — redaction on string/JSON serialisation", () => {
  it("toString returns the redacted sentinel, never the hex", () => {
    const key = new Uint8Array(32);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    expect(fp.toString()).toBe("<MasterKeyFingerprint:redacted>");
    expect(fp.toString()).not.toContain(fp.toHex());
  });

  it("template literal hits toString (so it's redacted)", () => {
    const key = new Uint8Array(32);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    const out = `fp=${fp}`;
    expect(out).toBe("fp=<MasterKeyFingerprint:redacted>");
    expect(out).not.toContain(fp.toHex());
  });

  it("JSON.stringify returns the redacted sentinel, not the hex", () => {
    const key = new Uint8Array(32);
    const fp = MasterKeyFingerprint.fromMasterKey(key);
    const json = JSON.stringify({ fp });
    expect(json).toBe('{"fp":"<MasterKeyFingerprint:redacted>"}');
    expect(json).not.toContain(fp.toHex());
  });
});

describe("MasterKeyFingerprint — class metadata helpers", () => {
  it("lengthBytes() is 8", () => {
    expect(MasterKeyFingerprint.lengthBytes()).toBe(8);
  });

  it("lengthHex() is 16", () => {
    expect(MasterKeyFingerprint.lengthHex()).toBe(16);
  });
});
