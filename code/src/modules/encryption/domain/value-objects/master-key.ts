import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Required length, in bytes, of an AES-256 master key.
 *
 * The encrypted-mode contract documented in
 * `docs/11-seguridad-modos.md` §3 / §7 derives a 32-byte key with
 * argon2id and feeds it to AES-256 (via SQLCipher). The 256-bit
 * length is therefore non-negotiable: shorter keys are rejected at
 * construction so a misconfigured derivation cannot leak through the
 * domain boundary.
 */
const MASTER_KEY_LENGTH_BYTES = 32;

/**
 * Sentinel string returned by every accessor that could otherwise
 * reveal the key material. Logging frameworks, JSON serializers and
 * even bare `String(key)` calls hit this constant instead of the
 * bytes; the redaction is therefore the SAFE default — the only way
 * to read the bytes is the explicit `withBytes(callback)` escape
 * hatch, which is auditable in code review.
 */
const REDACTED_REPRESENTATION = "<MasterKey:redacted>";

/**
 * Value object encapsulating the AES-256 master key of a workspace.
 *
 * The master key is the cryptographic root of the encrypted mode
 * (`docs/11-seguridad-modos.md` §3 / §7): it is the actual key that
 * SQLCipher uses to AES-encrypt `recall.db` and `vectors.db`.
 * Multiple `KeyEnvelope`s can wrap the same master key with
 * different user passphrases, but the master key itself is unique
 * per workspace.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The wrapped buffer is exactly `MASTER_KEY_LENGTH_BYTES` long.
 * - The buffer is NEVER exposed via a getter. The only way to obtain
 *   the bytes is `withBytes(callback)`, which receives a defensive
 *   copy in a controlled scope.
 * - `toString()` returns the redacted sentinel. Templating a master
 *   key (`"key=" + key`, ` `${key}`, `String(key)`) is therefore
 *   safe by construction.
 * - `toJSON()` returns the redacted sentinel. `JSON.stringify(key)`
 *   produces `"<MasterKey:redacted>"`, never the raw bytes. This is
 *   critical because logger frameworks (pino, etc.) serialize
 *   objects via `JSON.stringify` by default.
 * - Equality is constant-time (no early return on first mismatch) so
 *   that timing analysis cannot recover the key one byte at a time.
 *
 * Lifecycle:
 * - Instances are created either by the infrastructure layer (when
 *   generating a fresh CSPRNG-backed key during `mem.init`) or by
 *   `EnvelopeCipher.unwrap(envelope, derivedKey)` when a passphrase
 *   successfully decrypts an envelope.
 * - Instances are passed by reference around the application layer
 *   and finally discarded when the workspace is locked. JavaScript
 *   has no `mlock`-style API, so secure-zeroing is best-effort; the
 *   buffer copy in `withBytes` keeps the surface for accidental
 *   leaks small.
 */
export class MasterKey {
  /**
   * Internal buffer. Marked `private readonly` and accessed only via
   * `withBytes`, which clones it before exposing to the callback.
   * Never assign this field externally; never expose via getter.
   */
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    // Defensive copy at construction so the caller cannot keep an
    // alias to the same buffer and mutate it later.
    this.bytes = new Uint8Array(bytes);
  }

  /**
   * Builds a `MasterKey` from a raw 32-byte buffer. Used by the
   * infrastructure layer after CSPRNG generation or by
   * `EnvelopeCipher.unwrap`. The factory clones the input so the
   * caller can dispose of its own buffer safely.
   */
  public static from(raw: Uint8Array): MasterKey {
    if (!(raw instanceof Uint8Array)) {
      throw new InvalidInputError("master key must be a Uint8Array", {
        field: "master_key",
      });
    }
    if (raw.length !== MASTER_KEY_LENGTH_BYTES) {
      throw new InvalidInputError(
        `master key must be exactly ${String(MASTER_KEY_LENGTH_BYTES)} bytes (got: ${String(raw.length)})`,
        { field: "master_key" },
      );
    }
    return new MasterKey(raw);
  }

  /**
   * Length of the wrapped buffer, in bytes. Useful for diagnostics
   * without exposing the bytes themselves. Always returns
   * `MASTER_KEY_LENGTH_BYTES` by construction.
   */
  public length(): number {
    return this.bytes.length;
  }

  /**
   * The ONLY supported way to access the wrapped bytes. The callback
   * receives a fresh defensive copy; mutations to that copy do not
   * affect the VO. The closure pattern keeps the secret material
   * confined to a controlled scope and is easy to audit in code
   * review (`grep -R "withBytes(" src/`).
   *
   * Callers MUST NOT exfiltrate the buffer reference past the end of
   * the callback (e.g. by capturing it in a closure assigned to an
   * outer variable). The convention is enforced by code review and
   * by lint rules in the secrets/security validators.
   */
  public withBytes<TResult>(callback: (bytes: Uint8Array) => TResult): TResult {
    const copy = new Uint8Array(this.bytes);
    return callback(copy);
  }

  /**
   * Constant-time equality. Iterates the whole array regardless of
   * the first mismatch so a timing side-channel cannot recover the
   * key byte by byte. This matters for the `KeyValidator` flow where
   * an attacker could submit candidate keys and observe response
   * times.
   */
  public equals(other: MasterKey): boolean {
    if (this === other) return true;
    if (this.bytes.length !== other.bytes.length) return false;
    let diff = 0;
    for (let i = 0; i < this.bytes.length; i += 1) {
      const a = this.bytes[i] ?? 0;
      const b = other.bytes[i] ?? 0;
      diff |= a ^ b;
    }
    return diff === 0;
  }

  /**
   * SAFE BY CONSTRUCTION. Returns the redacted sentinel rather than
   * the bytes. This is what gets called by template literals,
   * `String(key)`, console.log default formatters and many logging
   * libraries.
   */
  public toString(): string {
    return REDACTED_REPRESENTATION;
  }

  /**
   * SAFE BY CONSTRUCTION. Returns the redacted sentinel rather than
   * the bytes. `JSON.stringify` calls `toJSON` automatically when
   * present, so structured logging frameworks (pino, winston) will
   * never accidentally serialize the key.
   */
  public toJSON(): string {
    return REDACTED_REPRESENTATION;
  }

  /** Exposes the configured key length for documentation/tests. */
  public static lengthBytes(): number {
    return MASTER_KEY_LENGTH_BYTES;
  }

  /** Exposes the redaction sentinel for documentation/tests. */
  public static redactedRepresentation(): string {
    return REDACTED_REPRESENTATION;
  }
}
