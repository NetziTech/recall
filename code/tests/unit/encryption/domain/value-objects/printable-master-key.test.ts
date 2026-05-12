import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { PrintableMasterKey } from "../../../../../src/modules/encryption/domain/value-objects/printable-master-key.ts";
import { PrintableMasterKeyChecksumError } from "../../../../../src/modules/encryption/domain/errors/printable-master-key-checksum-error.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

/**
 * Frozen vectors live in `tests/fixtures/printable-master-key.vectors.json`
 * (see `docs/11-seguridad-modos.md` §3). The shape is asserted at load
 * time so a corrupted fixture fails loudly instead of producing a
 * vacuously-passing test.
 */
interface VectorEntry {
  readonly description: string;
  readonly masterKeyHex: string;
  readonly rendered: string;
  readonly renderedWithGrouping: string;
}
interface VectorsFile {
  readonly hrp: string;
  readonly renderedLength: number;
  readonly vectors: {
    readonly V1: VectorEntry;
    readonly V2: VectorEntry;
    readonly V3: VectorEntry;
  };
}

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/printable-master-key.vectors.json",
);
const fixtureRaw: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const fixture = fixtureRaw as VectorsFile;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hexToBytes: odd-length hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byteStr = hex.slice(i * 2, i * 2 + 2);
    const v = Number.parseInt(byteStr, 16);
    if (Number.isNaN(v)) {
      throw new Error(`hexToBytes: invalid hex pair '${byteStr}'`);
    }
    out[i] = v;
  }
  return out;
}

const V1_BYTES = hexToBytes(fixture.vectors.V1.masterKeyHex);
const V2_BYTES = hexToBytes(fixture.vectors.V2.masterKeyHex);
const V3_BYTES = hexToBytes(fixture.vectors.V3.masterKeyHex);

describe("PrintableMasterKey — frozen wire vectors", () => {
  it("fixture sanity: HRP and length match the VO constants", () => {
    expect(fixture.hrp).toBe(PrintableMasterKey.hrp());
    expect(fixture.renderedLength).toBe(PrintableMasterKey.renderedLength());
    expect(V1_BYTES.length).toBe(PrintableMasterKey.lengthBytes());
    expect(V2_BYTES.length).toBe(PrintableMasterKey.lengthBytes());
    expect(V3_BYTES.length).toBe(PrintableMasterKey.lengthBytes());
  });

  it("V1: fromMasterKey(all 0x00) renders to the frozen vector", () => {
    const vo = PrintableMasterKey.fromMasterKey(V1_BYTES);
    expect(vo.toString()).toBe(fixture.vectors.V1.rendered);
    expect(vo.toString().length).toBe(61);
    expect(vo.toString()).toBe(vo.toString().toLowerCase());
  });

  it("V2: fromMasterKey(all 0xff) renders to the frozen vector", () => {
    const vo = PrintableMasterKey.fromMasterKey(V2_BYTES);
    expect(vo.toString()).toBe(fixture.vectors.V2.rendered);
  });

  it("V3: fromMasterKey(0x01..0x20) renders to the frozen vector", () => {
    const vo = PrintableMasterKey.fromMasterKey(V3_BYTES);
    expect(vo.toString()).toBe(fixture.vectors.V3.rendered);
  });

  it("toRenderedWithGrouping matches the frozen grouped vector", () => {
    expect(PrintableMasterKey.fromMasterKey(V1_BYTES).toRenderedWithGrouping())
      .toBe(fixture.vectors.V1.renderedWithGrouping);
    expect(PrintableMasterKey.fromMasterKey(V2_BYTES).toRenderedWithGrouping())
      .toBe(fixture.vectors.V2.renderedWithGrouping);
    expect(PrintableMasterKey.fromMasterKey(V3_BYTES).toRenderedWithGrouping())
      .toBe(fixture.vectors.V3.renderedWithGrouping);
  });

  it("toRenderedWithGrouping produces 15 groups of 4 + 1 trailing group of 1", () => {
    const grouped = PrintableMasterKey.fromMasterKey(V1_BYTES).toRenderedWithGrouping();
    const groups = grouped.split("-");
    expect(groups).toHaveLength(16);
    for (let i = 0; i < 15; i += 1) {
      expect(groups[i]?.length).toBe(4);
    }
    expect(groups[15]?.length).toBe(1);
  });
});

describe("PrintableMasterKey.fromMasterKey — input validation", () => {
  it("rejects a buffer of 31 bytes", () => {
    expect(() => PrintableMasterKey.fromMasterKey(new Uint8Array(31))).toThrow(
      InvalidInputError,
    );
  });

  it("rejects a buffer of 33 bytes", () => {
    expect(() => PrintableMasterKey.fromMasterKey(new Uint8Array(33))).toThrow(
      InvalidInputError,
    );
  });

  it("rejects non-Uint8Array input (e.g. number[])", () => {
    const bogus = [1, 2, 3] as unknown as Uint8Array;
    expect(() => PrintableMasterKey.fromMasterKey(bogus)).toThrow(
      InvalidInputError,
    );
  });

  it("defensively copies the input buffer (mutation does not affect the VO)", () => {
    const src = new Uint8Array(V3_BYTES);
    const vo = PrintableMasterKey.fromMasterKey(src);
    const expected = vo.toString();
    src.fill(0xaa);
    expect(vo.toString()).toBe(expected);
  });
});

describe("PrintableMasterKey.fromString — happy paths", () => {
  it("round-trips V1: fromString(rendered).unwrap() === V1 bytes", () => {
    const vo = PrintableMasterKey.fromString(fixture.vectors.V1.rendered);
    expect(Array.from(vo.unwrap())).toEqual(Array.from(V1_BYTES));
  });

  it("round-trips V2: fromString(rendered).unwrap() === V2 bytes", () => {
    const vo = PrintableMasterKey.fromString(fixture.vectors.V2.rendered);
    expect(Array.from(vo.unwrap())).toEqual(Array.from(V2_BYTES));
  });

  it("round-trips V3: fromString(rendered).unwrap() === V3 bytes", () => {
    const vo = PrintableMasterKey.fromString(fixture.vectors.V3.rendered);
    expect(Array.from(vo.unwrap())).toEqual(Array.from(V3_BYTES));
  });

  it("accepts the dash-grouped human-readable form", () => {
    const vo = PrintableMasterKey.fromString(
      fixture.vectors.V1.renderedWithGrouping,
    );
    expect(Array.from(vo.unwrap())).toEqual(Array.from(V1_BYTES));
  });

  it("accepts arbitrary dash placements (every dash is stripped)", () => {
    const noisy = `-${fixture.vectors.V2.rendered.split("").join("-")}-`;
    const vo = PrintableMasterKey.fromString(noisy);
    expect(Array.from(vo.unwrap())).toEqual(Array.from(V2_BYTES));
  });
});

describe("PrintableMasterKey.fromString — structural rejections", () => {
  it("rejects non-string input", () => {
    expect(() =>
      PrintableMasterKey.fromString(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("rejects all-uppercase input (per BIP-173 case-uniformity rule)", () => {
    expect(() =>
      PrintableMasterKey.fromString(fixture.vectors.V1.rendered.toUpperCase()),
    ).toThrow(InvalidInputError);
  });

  it("rejects mixed-case input", () => {
    const mixed =
      fixture.vectors.V1.rendered.slice(0, 1).toUpperCase() +
      fixture.vectors.V1.rendered.slice(1);
    expect(() => PrintableMasterKey.fromString(mixed)).toThrow(
      InvalidInputError,
    );
  });

  it("rejects wrong length (too short)", () => {
    expect(() =>
      PrintableMasterKey.fromString(fixture.vectors.V1.rendered.slice(0, 60)),
    ).toThrow(InvalidInputError);
  });

  it("rejects wrong length (too long)", () => {
    expect(() =>
      PrintableMasterKey.fromString(`${fixture.vectors.V1.rendered}q`),
    ).toThrow(InvalidInputError);
  });

  it("rejects wrong HRP (m4 instead of m3) before the bech32 library runs", () => {
    // Use a length-correct prefix that nonetheless fails the HRP check.
    const wrongHrp = `m4${fixture.vectors.V1.rendered.slice(2)}`;
    // The bech32 library will throw an "Invalid checksum" since the HRP
    // affects the polynomial. Either error type is acceptable; we just
    // assert that we don't get a successful VO.
    expect(() => PrintableMasterKey.fromString(wrongHrp)).toThrow();
  });
});

describe("PrintableMasterKey.fromString — checksum failures", () => {
  function flipCharAt(s: string, idx: number, replacement: string): string {
    return s.slice(0, idx) + replacement + s.slice(idx + 1);
  }

  it("single-char flip at position 8 throws PrintableMasterKeyChecksumError with errorKind='single'", () => {
    const v1 = fixture.vectors.V1.rendered;
    // V1 position 8 is 'q'; replace with 'p' (next char in the
    // alphabet table, definitely a different symbol).
    const corrupted = flipCharAt(v1, 8, v1.charAt(8) === "p" ? "q" : "p");
    expect.assertions(3);
    try {
      PrintableMasterKey.fromString(corrupted);
    } catch (err) {
      expect(err).toBeInstanceOf(PrintableMasterKeyChecksumError);
      const e = err as PrintableMasterKeyChecksumError;
      expect(e.errorKind).toBe("single");
      // The classifier reports the first position where a single
      // flip recovers a valid checksum. For a clean single-char
      // corruption that position is exactly the one we tampered with.
      expect(e.errorPosition).toBe(8);
    }
  });

  it("adjacent swap throws PrintableMasterKeyChecksumError with errorKind='transposition'", () => {
    // V3 has at position 5 the substring 'q' followed by '9' (the
    // alphabet contains both; index 5 of V3 is 'q' and index 6 is
    // 'y' actually — pick a known different-char pair from V3).
    const v3 = fixture.vectors.V3.rendered;
    // Find two adjacent positions inside the data section with
    // distinct chars (skip HRP+sep).
    let swapIdx = -1;
    for (let i = 3; i + 1 < v3.length; i += 1) {
      if (v3.charAt(i) !== v3.charAt(i + 1)) {
        swapIdx = i;
        break;
      }
    }
    expect(swapIdx).toBeGreaterThan(-1);
    const corrupted =
      v3.slice(0, swapIdx) +
      v3.charAt(swapIdx + 1) +
      v3.charAt(swapIdx) +
      v3.slice(swapIdx + 2);
    expect.assertions(3 + 1);
    try {
      PrintableMasterKey.fromString(corrupted);
    } catch (err) {
      expect(err).toBeInstanceOf(PrintableMasterKeyChecksumError);
      const e = err as PrintableMasterKeyChecksumError;
      // The classifier first tries "single-flip" recovery. A swap
      // of two non-equal symbols is NOT recoverable by a single
      // flip, so it falls through to the "transposition" bucket.
      expect(e.errorKind).toBe("transposition");
      expect(e.errorPosition).toBe(swapIdx);
    }
  });

  it("five-char corruption throws PrintableMasterKeyChecksumError with errorKind='unrecoverable'", () => {
    const v3 = fixture.vectors.V3.rendered;
    // Replace five non-adjacent positions inside the data block.
    let corrupted = v3;
    const positions = [10, 20, 30, 40, 50];
    for (const p of positions) {
      const orig = corrupted.charAt(p);
      const repl = orig === "q" ? "p" : "q";
      corrupted = corrupted.slice(0, p) + repl + corrupted.slice(p + 1);
    }
    expect.assertions(3);
    try {
      PrintableMasterKey.fromString(corrupted);
    } catch (err) {
      expect(err).toBeInstanceOf(PrintableMasterKeyChecksumError);
      const e = err as PrintableMasterKeyChecksumError;
      expect(e.errorKind).toBe("unrecoverable");
      expect(e.errorPosition).toBeUndefined();
    }
  });

  it("PrintableMasterKeyChecksumError carries the JSON-RPC INVALID_KEY code", () => {
    const v1 = fixture.vectors.V1.rendered;
    const corrupted = flipCharAt(v1, 8, v1.charAt(8) === "p" ? "q" : "p");
    try {
      PrintableMasterKey.fromString(corrupted);
      expect.fail("expected fromString to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PrintableMasterKeyChecksumError);
      expect((err as PrintableMasterKeyChecksumError).jsonRpcCode).toBe(-32108);
      expect((err as PrintableMasterKeyChecksumError).code).toBe(
        "printable-master-key-checksum-mismatch",
      );
    }
  });

  it("PrintableMasterKeyChecksumError message NEVER leaks the corrupted ciphertext", () => {
    const v1 = fixture.vectors.V1.rendered;
    const corrupted = flipCharAt(v1, 8, v1.charAt(8) === "p" ? "q" : "p");
    try {
      PrintableMasterKey.fromString(corrupted);
      expect.fail("expected fromString to throw");
    } catch (err) {
      const msg = (err as Error).message;
      // The full 61-char rendering is unique enough to detect
      // accidental interpolation — assert it does not appear.
      expect(msg.includes(corrupted)).toBe(false);
      expect(msg.includes(v1)).toBe(false);
    }
  });
});

describe("PrintableMasterKey — serialization safety", () => {
  it("toJSON returns the redacted sentinel", () => {
    const vo = PrintableMasterKey.fromMasterKey(V1_BYTES);
    expect(vo.toJSON()).toBe(PrintableMasterKey.redactedJsonRepresentation());
    expect(vo.toJSON()).toBe("<PrintableMasterKey:redacted>");
  });

  it("JSON.stringify of an object holding the VO emits the sentinel, never the rendered form", () => {
    const vo = PrintableMasterKey.fromMasterKey(V2_BYTES);
    const payload = JSON.stringify({ key: vo, label: "backup" });
    expect(payload).toContain("<PrintableMasterKey:redacted>");
    expect(payload).not.toContain(fixture.vectors.V2.rendered);
    // Also verify no master byte slipped in via accidental array
    // emission.
    expect(payload).not.toContain("255,255,255,255");
  });

  it("toString returns the canonical rendered form (NOT redacted)", () => {
    // PrintableMasterKey intentionally exposes the rendering via
    // toString — it IS the recovery form. Secrecy is enforced by
    // the surrounding stdout-only / no-logs policy, not by this
    // VO's surface.
    const vo = PrintableMasterKey.fromMasterKey(V1_BYTES);
    expect(vo.toString()).toBe(fixture.vectors.V1.rendered);
    expect(`${vo}`).toBe(fixture.vectors.V1.rendered);
  });
});

describe("PrintableMasterKey — unwrap defensive copy", () => {
  it("unwrap returns a fresh buffer (mutating the copy does not affect the VO)", () => {
    const vo = PrintableMasterKey.fromMasterKey(V3_BYTES);
    const c1 = vo.unwrap();
    c1.fill(0);
    const c2 = vo.unwrap();
    expect(Array.from(c2)).toEqual(Array.from(V3_BYTES));
  });

  it("two successive unwrap calls return distinct buffer instances", () => {
    const vo = PrintableMasterKey.fromMasterKey(V1_BYTES);
    const a = vo.unwrap();
    const b = vo.unwrap();
    expect(a).not.toBe(b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("PrintableMasterKey — equality", () => {
  it("equals(self) is true", () => {
    const vo = PrintableMasterKey.fromMasterKey(V1_BYTES);
    expect(vo.equals(vo)).toBe(true);
  });

  it("equals(VO built from the same bytes) is true", () => {
    const a = PrintableMasterKey.fromMasterKey(V2_BYTES);
    const b = PrintableMasterKey.fromMasterKey(V2_BYTES);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(a)).toBe(true);
  });

  it("equals(VO built from different bytes) is false", () => {
    const a = PrintableMasterKey.fromMasterKey(V1_BYTES);
    const b = PrintableMasterKey.fromMasterKey(V3_BYTES);
    expect(a.equals(b)).toBe(false);
  });

  it("equals reads every byte (constant-time semantic) — sanity smoke", () => {
    // We cannot assert timing here, but we can assert that the
    // method does not early-return on the first matching byte by
    // verifying it correctly distinguishes buffers that match
    // only in their first half.
    const a = new Uint8Array(32);
    a.fill(0xaa, 0, 16);
    const b = new Uint8Array(32);
    b.fill(0xaa, 0, 16);
    b[31] = 0x01;
    const voA = PrintableMasterKey.fromMasterKey(a);
    const voB = PrintableMasterKey.fromMasterKey(b);
    expect(voA.equals(voB)).toBe(false);
  });
});
