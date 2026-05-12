import { sha256 } from "@noble/hashes/sha2.js";

import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Number of bytes of the SHA-256 prefix used as fingerprint.
 *
 * Truncating SHA-256 to 8 bytes gives a 64-bit space — more than
 * enough to correlate audit-log rows for the same master key within a
 * single workspace (a workspace whose audit log holds 2^32 rows is
 * already beyond any realistic retention budget; the 64-bit space
 * absorbs the birthday-paradox margin without bloating the column).
 */
const FINGERPRINT_LENGTH_BYTES = 8;

/**
 * Length, in lowercase hex characters, of the canonical representation.
 * `FINGERPRINT_LENGTH_BYTES * 2`.
 */
const FINGERPRINT_LENGTH_HEX = FINGERPRINT_LENGTH_BYTES * 2;

/**
 * Length, in bytes, of an AES-256 master key. Mirrors the constant in
 * `MasterKey`; redeclared here so this VO is self-contained for code
 * review (the file is the chosen entry point for fingerprint hygiene
 * audits).
 */
const MASTER_KEY_LENGTH_BYTES = 32;

/**
 * Regex matching the canonical lowercase-hex form. `FINGERPRINT_LENGTH_HEX`
 * is interpolated at compile time so the literal stays in sync with the
 * length constants.
 */
const FINGERPRINT_HEX_PATTERN = new RegExp(`^[0-9a-f]{${String(FINGERPRINT_LENGTH_HEX)}}$`);

/**
 * Value object representing a local correlation fingerprint of a
 * workspace `MasterKey`.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * The fingerprint is `SHA-256(masterKeyBytes)[:8 bytes]`, encoded as
 * 16 lowercase hex characters. It exists solely to power the
 * `encryption_audit_log.master_key_fp` column so audit consumers can
 * answer "which envelopes unlocked the same master key during this
 * window?" without ever touching the master key itself.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - **Local-only.** Instances MUST NEVER be serialised outside the
 *   audit-log adapter (`SqliteEncryptionAuditRepository`). The
 *   adapter writes the hex string into the row; no other adapter is
 *   allowed to read fingerprints back. No `toJSON`, no logger
 *   payload, no error message, no wire schema, no CLI output may
 *   include a fingerprint.
 * - **Truncated, not derived.** The fingerprint is a *one-way*
 *   SHA-256 prefix; the master key cannot be reconstructed from it.
 *   Still, the 64-bit space is small enough that a determined
 *   attacker with millions of candidate keys could brute-force
 *   correlations. The mitigation is procedural (the adapter never
 *   exposes a read API).
 * - **Constant-time equality.** `equals` iterates the full hex string
 *   without early return so timing analysis cannot recover the
 *   fingerprint character by character. The threat model is mild
 *   (the fingerprint is already truncated) but the cost is zero.
 * - **Defensive copy at construction.** The factory clones the input
 *   bytes before hashing so the caller cannot mutate the buffer
 *   under the VO. JavaScript has no `mlock`-style API; the
 *   defensive copy keeps the surface for accidental leaks small.
 *
 * Why a VO (not a free helper):
 * - Encodes the invariants of "exactly `FINGERPRINT_LENGTH_HEX`
 *   lowercase hex characters" once, at construction, so every
 *   downstream consumer can rely on the shape without revalidating.
 * - Disables `JSON.stringify` leaks: `toJSON()` returns the redacted
 *   sentinel so structured loggers (pino, winston) cannot accidentally
 *   serialise the fingerprint when an `EncryptionAuditEvent` object
 *   appears inside a log payload.
 * - Identity by value (`equals`) keeps the audit-log adapter free of
 *   raw-string comparisons; the type system guarantees nobody mixes
 *   a fingerprint with a `KeyId` or an `EnvelopeId`.
 *
 * Equality:
 * - Two fingerprints are equal iff their canonical (lowercase hex)
 *   values match character-for-character.
 */
export class MasterKeyFingerprint {
  /**
   * Sentinel returned by accessors that could otherwise reveal the
   * fingerprint in a serialised payload. The bytes are not secret in
   * the same sense as a master key, but exposing them outside the
   * audit-log adapter would weaken the procedural barrier described
   * in the class JSDoc.
   */
  private static readonly REDACTED_REPRESENTATION =
    "<MasterKeyFingerprint:redacted>";

  private constructor(private readonly hex: string) {}

  /**
   * Computes `SHA-256(masterKeyBytes)[:8 bytes]` and returns it as a
   * `MasterKeyFingerprint`.
   *
   * Validates that the input is a `Uint8Array` of exactly 32 bytes
   * (an AES-256 master key). Throws `InvalidInputError` for any other
   * shape; the audit-log adapter relies on the factory to gate
   * malformed inputs out before they reach SQLite.
   *
   * @param masterKeyBytes Raw master-key bytes (e.g. obtained inside a
   *                       `MasterKey.withBytes(...)` closure).
   */
  public static fromMasterKey(masterKeyBytes: Uint8Array): MasterKeyFingerprint {
    if (!(masterKeyBytes instanceof Uint8Array)) {
      throw new InvalidInputError(
        "master key bytes must be a Uint8Array",
        { field: "master_key_bytes" },
      );
    }
    if (masterKeyBytes.length !== MASTER_KEY_LENGTH_BYTES) {
      throw new InvalidInputError(
        `master key bytes must be exactly ${String(MASTER_KEY_LENGTH_BYTES)} bytes (got: ${String(masterKeyBytes.length)})`,
        { field: "master_key_bytes" },
      );
    }
    // Defensive copy: hashing through `@noble/hashes` does not mutate
    // the input, but the copy keeps the surface uniform with every
    // other VO that accepts secret bytes (`MasterKey`, `DerivedKey`).
    const copy = new Uint8Array(masterKeyBytes);
    const digest = sha256(copy);
    const prefix = digest.subarray(0, FINGERPRINT_LENGTH_BYTES);
    const hex = MasterKeyFingerprint.bytesToHex(prefix);
    return new MasterKeyFingerprint(hex);
  }

  /**
   * Rehydrates a fingerprint from its canonical hex representation.
   * Used exclusively by the audit-log adapter when reading rows back
   * for tests; production adapters never expose a read API that
   * returns fingerprints.
   *
   * @param hex Lowercase hex string of length
   *            `FINGERPRINT_LENGTH_HEX`.
   */
  public static fromHex(hex: string): MasterKeyFingerprint {
    if (typeof hex !== "string") {
      throw new InvalidInputError(
        "master key fingerprint hex must be a string",
        { field: "fingerprint_hex" },
      );
    }
    if (!FINGERPRINT_HEX_PATTERN.test(hex)) {
      throw new InvalidInputError(
        `master key fingerprint hex must be ${String(FINGERPRINT_LENGTH_HEX)} lowercase hex characters`,
        { field: "fingerprint_hex" },
      );
    }
    return new MasterKeyFingerprint(hex);
  }

  /**
   * Returns the canonical lowercase-hex form (16 characters). Used by
   * the audit-log adapter to bind the value to SQLite.
   *
   * **Call site discipline:** every caller of `toHex()` MUST be
   * audited; the method exists only so the persistence adapter can
   * serialise the value into the `master_key_fp` column.
   */
  public toHex(): string {
    return this.hex;
  }

  /**
   * Length, in bytes, of the SHA-256 prefix used as fingerprint.
   * Exposed for documentation and tests.
   */
  public static lengthBytes(): number {
    return FINGERPRINT_LENGTH_BYTES;
  }

  /**
   * Length, in lowercase hex characters, of the canonical
   * representation. Exposed for documentation and tests.
   */
  public static lengthHex(): number {
    return FINGERPRINT_LENGTH_HEX;
  }

  /**
   * Constant-time equality. Iterates the entire string regardless of
   * the first mismatch so a timing side-channel cannot recover the
   * fingerprint character by character.
   */
  public equals(other: MasterKeyFingerprint): boolean {
    if (this === other) return true;
    if (this.hex.length !== other.hex.length) return false;
    let diff = 0;
    for (let i = 0; i < this.hex.length; i += 1) {
      const a = this.hex.charCodeAt(i);
      const b = other.hex.charCodeAt(i);
      diff |= a ^ b;
    }
    return diff === 0;
  }

  /**
   * SAFE BY CONSTRUCTION. Returns the redacted sentinel rather than
   * the hex string. Template literals, `String(fp)` and many logger
   * default formatters hit this method.
   */
  public toString(): string {
    return MasterKeyFingerprint.REDACTED_REPRESENTATION;
  }

  /**
   * SAFE BY CONSTRUCTION. `JSON.stringify` calls `toJSON` when
   * present, so structured logging frameworks (pino, winston) emit
   * the redacted sentinel — never the actual fingerprint — when an
   * audit-event object is logged. The audit-log adapter intentionally
   * bypasses this method by calling `toHex()` explicitly at the
   * persistence boundary.
   */
  public toJSON(): string {
    return MasterKeyFingerprint.REDACTED_REPRESENTATION;
  }

  /**
   * Hex encoder. Implemented in-line so the VO is self-contained and
   * the hot path stays a tight loop over a typed array.
   *
   * Uses `String.prototype.padStart` over each byte's `toString(16)`
   * representation: simple, branch-free (modulo the padStart fast
   * path inside V8) and `noUncheckedIndexedAccess`-friendly (no
   * indexed lookups into a digit-table string, which would surface
   * `string | undefined` and force a non-null assertion banned by
   * `@typescript-eslint/no-non-null-assertion`).
   */
  private static bytesToHex(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) {
      out += byte.toString(16).padStart(2, "0");
    }
    return out;
  }
}
