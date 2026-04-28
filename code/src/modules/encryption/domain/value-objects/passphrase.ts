import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Minimum length, in characters, of a user-supplied passphrase.
 *
 * The encrypted-mode flow documented in `docs/11-seguridad-modos.md`
 * §3 prints a 38-character grouped key (`M3-ZK7L-Q4WV-...`) but the
 * unlock CLI also accepts user-typed passphrases for multi-key
 * setups (§7 "Multi-key (v0.5+)"). Setting a generous floor of 12
 * characters keeps the door open for the user to type a custom
 * passphrase while still rejecting obvious garbage like the empty
 * string. Stronger entropy enforcement (zxcvbn-style) is a job for
 * the application layer because it requires localized feedback.
 */
const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Sentinel string returned by every accessor that could otherwise
 * reveal the passphrase. Mirrors the redaction strategy of
 * `MasterKey` / `DerivedKey`; see `master-key.ts` for the rationale.
 */
const REDACTED_REPRESENTATION = "<Passphrase:redacted>";

/**
 * Value object encapsulating a user-supplied passphrase.
 *
 * The passphrase is the input fed to the KDF (`KeyDerivation.derive`)
 * to produce the `DerivedKey` that AEAD-decrypts a key envelope. It
 * is the only secret the user is asked to remember (or paste from a
 * password manager); it must NEVER appear in logs, transcripts, or
 * error messages.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The wrapped string is at least `MIN_PASSPHRASE_LENGTH` characters
 *   long after trimming leading/trailing whitespace. The trimmed form
 *   is the canonical value used by the KDF.
 * - The wrapped string is NEVER exposed via a getter. The only way
 *   to obtain the characters is `withChars(callback)`, which receives
 *   a copy.
 * - `length()` returns the count of characters, not the characters
 *   themselves. Useful for diagnostics ("12 characters") without
 *   leaking content.
 * - `toString()` returns the redacted sentinel.
 * - `toJSON()` returns the redacted sentinel.
 * - Equality is constant-time across the byte representation so a
 *   timing side-channel cannot enumerate the passphrase.
 *
 * Lifecycle:
 * - Built by the CLI / MCP transport from user input.
 * - Consumed once by `KeyDerivation.derive(...)` and discarded.
 * - JavaScript strings are immutable so secure-zeroing is impossible
 *   in the standard runtime; the redaction discipline keeps the
 *   surface for accidental leaks small in practice.
 */
export class Passphrase {
  /**
   * Internal buffer. Marked `private readonly` and accessed only via
   * `withChars`, which copies it before exposing to the callback.
   * Never assign this field externally; never expose via getter.
   */
  private readonly chars: string;

  private constructor(chars: string) {
    this.chars = chars;
  }

  /**
   * Builds a `Passphrase` from a raw string. Trims whitespace and
   * enforces the minimum length floor.
   *
   * The trim is deliberate: terminals frequently append newlines to
   * pasted strings, and humans add spurious spaces; failing to trim
   * would lock the user out for a reason no log entry could safely
   * explain (we cannot show the offending character).
   */
  public static from(raw: string): Passphrase {
    if (typeof raw !== "string") {
      throw new InvalidInputError("passphrase must be a string", {
        field: "passphrase",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN_PASSPHRASE_LENGTH) {
      throw new InvalidInputError(
        `passphrase must be at least ${String(MIN_PASSPHRASE_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "passphrase" },
      );
    }
    return new Passphrase(trimmed);
  }

  /**
   * Returns the number of characters in the passphrase WITHOUT
   * exposing the characters themselves. Safe to log.
   */
  public length(): number {
    return this.chars.length;
  }

  /**
   * The ONLY supported way to access the wrapped characters. The
   * callback receives a copy (strings are immutable in JS so the
   * "copy" is the same value, but the API is symmetric with the
   * other secret VOs and prevents accidental capture of `this`).
   *
   * Callers MUST NOT exfiltrate the string past the end of the
   * callback (e.g. by capturing it in a closure assigned to an
   * outer variable).
   */
  public withChars<TResult>(callback: (chars: string) => TResult): TResult {
    return callback(this.chars);
  }

  /**
   * Constant-time equality across the UTF-16 code unit
   * representation. Iterates the whole string regardless of the
   * first mismatch so a timing side-channel cannot recover the
   * passphrase one character at a time.
   */
  public equals(other: Passphrase): boolean {
    if (this === other) return true;
    if (this.chars.length !== other.chars.length) return false;
    let diff = 0;
    for (let i = 0; i < this.chars.length; i += 1) {
      const a = this.chars.charCodeAt(i);
      const b = other.chars.charCodeAt(i);
      diff |= a ^ b;
    }
    return diff === 0;
  }

  public toString(): string {
    return REDACTED_REPRESENTATION;
  }

  public toJSON(): string {
    return REDACTED_REPRESENTATION;
  }

  /** Exposes the configured minimum length for documentation/tests. */
  public static minLength(): number {
    return MIN_PASSPHRASE_LENGTH;
  }

  /** Exposes the redaction sentinel for documentation/tests. */
  public static redactedRepresentation(): string {
    return REDACTED_REPRESENTATION;
  }
}
