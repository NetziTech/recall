import { bech32 } from "bech32";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { PrintableMasterKeyChecksumError } from "../errors/printable-master-key-checksum-error.ts";

/**
 * Required size, in bytes, of the master key encoded by this VO.
 *
 * Mirrors `MasterKey.lengthBytes()` (32 bytes / 256 bits, AES-256).
 * Kept as a private constant rather than importing `MasterKey` so
 * the VO has no upstream dependency on the secret-material wrapper
 * and can be unit-tested in isolation with raw `Uint8Array`s.
 */
const MASTER_KEY_LENGTH_BYTES = 32;

/**
 * Human-readable prefix (HRP, per BIP-173 vocabulary) used by every
 * printable master key emitted by this product.
 *
 * Two characters: `m` for "memoria/master key" and `3` for the
 * schema major version. A future breaking change to the rendering
 * (different key length, different polynomial, different alphabet)
 * MUST bump this to `m4` so old and new strings are unambiguously
 * distinguishable by their prefix.
 *
 * Lowercase by spec — `docs/11-seguridad-modos.md` §3 ("lowercase
 * obligatorio en wire").
 */
const HRP = "m3";

/**
 * Fixed total length, in characters, of the canonical (dash-stripped,
 * lowercase) printable master key:
 *
 *   2 (HRP) + 1 (separator `1`) + 52 (data, 32 bytes @ 5 bits each)
 *   + 6 (BCH checksum) = 61 chars.
 *
 * Hard-coded here so the parser can reject malformed input cheaply,
 * before invoking the Bech32 library.
 */
const RENDERED_LENGTH = 61;

/**
 * Cosmetic group size used when rendering the key for human reading.
 * The string is broken every `GROUP_SIZE` chars with a `-`; the
 * dashes are NEVER part of the checksum and MUST be stripped before
 * decoding. See `docs/11-seguridad-modos.md` §3.
 */
const GROUP_SIZE = 4;

/**
 * `LIMIT` argument passed to `bech32.encode` / `bech32.decode`.
 *
 * BIP-173 caps Bech32 strings at 90 characters for the polynomial
 * to retain its error-detection guarantees (up to 4 errors). Our
 * payload is exactly 61 chars — well under the limit — but we pass
 * `90` explicitly to opt in to the standard guarantee surface.
 */
const BECH32_LIMIT = 90;

/**
 * Lowercase Bech32 alphabet, in the canonical index order documented
 * in `docs/11-seguridad-modos.md` §3 (table "Alfabeto Bech32").
 * Excludes `1`, `b`, `i`, `o` to avoid visual confusion with `l`,
 * `8`, `1`, `0`. Used only by the heuristic classifier to enumerate
 * candidate single-character flips when explaining why a checksum
 * failed.
 */
const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/**
 * Sentinel string returned by `toJSON`. Keeps `JSON.stringify` from
 * accidentally serialising the rendered Bech32 form into structured
 * logs (pino, winston). Unlike the bytes wrapped by `MasterKey`,
 * the rendered string IS expected to be shown to the human user via
 * stdout, so `toString()` returns the canonical form rather than a
 * redaction sentinel — but no automated log pipeline should ever
 * emit it.
 */
const REDACTED_JSON_REPRESENTATION = "<PrintableMasterKey:redacted>";

/**
 * Heuristic single-character flip detector. Iterates every position
 * of the candidate string and every other alphabet character, trying
 * to find ONE substitution that makes the Bech32 checksum validate.
 * If exactly one such substitution exists, the original typo was a
 * single-character flip and we can report the position.
 *
 * Complexity: O(31 * 58) decode attempts (52 data chars + 6 checksum
 * chars × 31 alternative letters per position). Each `decodeUnsafe`
 * call is O(string length). Negligible at the 61-char scale.
 *
 * Why this is NOT security custom: BCH is still the only primitive
 * making any cryptographic claim. The brute-force scan is a UX
 * helper that classifies failures into "single typo (correctable
 * mentally)" vs "more than one typo (re-check the whole string)";
 * it has no impact on the actual accept/reject decision, which
 * remains hard-reject for every checksum failure.
 */
function findSingleFlipPosition(stripped: string): number | undefined {
  for (let i = HRP.length + 1; i < stripped.length; i += 1) {
    const original = stripped.charAt(i);
    for (const candidate of ALPHABET) {
      if (candidate === original) continue;
      const trial = stripped.slice(0, i) + candidate + stripped.slice(i + 1);
      const decoded = bech32.decodeUnsafe(trial, BECH32_LIMIT);
      if (decoded?.prefix === HRP) {
        return i;
      }
    }
  }
  return undefined;
}

/**
 * Heuristic adjacent-swap detector. If swapping a pair of neighbour
 * characters makes the Bech32 checksum validate, the original typo
 * was a transposition. Reports the left index of the swapped pair.
 *
 * Complexity: O(58) decode attempts (one per pair). See
 * `findSingleFlipPosition` for the rationale.
 */
function findAdjacentSwapPosition(stripped: string): number | undefined {
  for (let i = HRP.length + 1; i + 1 < stripped.length; i += 1) {
    const a = stripped.charAt(i);
    const b = stripped.charAt(i + 1);
    if (a === b) continue;
    const trial =
      stripped.slice(0, i) + b + a + stripped.slice(i + 2);
    const decoded = bech32.decodeUnsafe(trial, BECH32_LIMIT);
    if (decoded?.prefix === HRP) {
      return i;
    }
  }
  return undefined;
}

/**
 * Tagged union returned by `classifyChecksumFailure`. The
 * discriminant `errorKind` decides whether `errorPosition` is
 * present, which TypeScript narrows correctly at the call site
 * under `exactOptionalPropertyTypes: true`.
 */
type ChecksumFailureClassification =
  | { readonly errorKind: "single"; readonly errorPosition: number }
  | { readonly errorKind: "transposition"; readonly errorPosition: number }
  | { readonly errorKind: "unrecoverable" };

/**
 * Classifies a checksum failure into one of three buckets used to
 * render a helpful CLI hint. NEVER influences accept/reject — the
 * caller already decided to reject before invoking the classifier.
 */
function classifyChecksumFailure(
  stripped: string,
): ChecksumFailureClassification {
  const singlePos = findSingleFlipPosition(stripped);
  if (singlePos !== undefined) {
    return { errorKind: "single", errorPosition: singlePos };
  }
  const swapPos = findAdjacentSwapPosition(stripped);
  if (swapPos !== undefined) {
    return { errorKind: "transposition", errorPosition: swapPos };
  }
  return { errorKind: "unrecoverable" };
}

/**
 * Inserts a `-` every `GROUP_SIZE` chars to produce the
 * human-readable rendering. The dashes are cosmetic ONLY and are
 * stripped before any checksum verification.
 */
function applyCosmeticGrouping(canonical: string): string {
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += GROUP_SIZE) {
    groups.push(canonical.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Value object that wraps a master key in its **printable** Bech32
 * representation (`m3` + separator + 52 data chars + 6 checksum
 * chars = 61 chars), used as the recovery/export form shown to the
 * human user.
 *
 * Spec frozen in `docs/11-seguridad-modos.md` §3 ("Formato de la
 * clave de recuperacion"); ADR-005 Q3
 * (`docs/12-lineamientos-arquitectura.md` §1.5.5 appendix Q3)
 * ratifies Bech32 BIP-173 as the chosen encoding. This file MUST be
 * read alongside those documents — the constants here are not
 * arbitrary.
 *
 * Why Bech32 and not hex / BIP-39 / something custom:
 * - hex has no error detection ⇒ a single typo silently produces
 *   "wrong key" with no hint of where the user slipped;
 * - BIP-39 takes ~200 chars and depends on a wordlist;
 * - a custom encoding violates the repo rule "no security custom"
 *   (ADR-004) ⇒ we delegate the algorithm to the `bech32` npm
 *   package, BIP-173 implementation audited in Bitcoin since 2017.
 *
 * Lifecycle:
 * - Built via `fromMasterKey(bytes)` after CSPRNG generation by the
 *   infrastructure layer (`mem.init` or rekey flows), or via
 *   `fromString(raw)` when the user types/pastes a recovery key
 *   that the CLI must validate before attempting `unlockWith()`.
 * - Consumed by exactly two callers:
 *     1. `UnlockEncryptionUseCase` reads `unwrap()` to obtain the
 *        32-byte master key candidate and feed SQLCipher;
 *     2. `ExportMasterKeyUseCase` reads `toRenderedWithGrouping()`
 *        to print the recovery key on stdout (NEVER through the
 *        MCP channel — see `docs/11-seguridad-modos.md` §3 "Por
 *        que solo por stdout").
 *   Every other consumer should be reviewed as a potential leak.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The constructor is `private`; instances are obtained only
 *   through the audited factories.
 * - Both factories copy their inputs defensively, so the caller
 *   cannot keep an alias and mutate the wrapped bytes.
 * - `unwrap()` returns a fresh defensive copy on every call.
 * - `toJSON()` returns the redaction sentinel; structured logs
 *   never accidentally serialise the rendered form.
 * - `toString()` returns the canonical (dash-less) rendering. This
 *   is intentional because the printable master key IS the public
 *   recovery representation — the secrecy boundary is enforced by
 *   "do not show it in logs / do not transmit through MCP", not
 *   by the type system.
 * - Equality is constant-time over the wrapped bytes (mirrors the
 *   `MasterKey` invariant) so timing analysis cannot recover the
 *   key one byte at a time.
 * - Checksum failures HARD-REJECT (no `unlockWith` attempt is
 *   performed by the caller); see
 *   `docs/11-seguridad-modos.md` §3 "Comportamiento ante
 *   checksum-fail".
 *
 * Legacy key migration: pre-spec keys (e.g. early v0.1.x exports
 * that may have shipped without checksum) are NOT parseable here.
 * The CLI exposes a `--skip-checksum` opt-in for those cases that
 * routes around this VO. See `docs/11-seguridad-modos.md` §3
 * ("Migracion de claves legacy"). Implementing that path is the
 * responsibility of `UnlockEncryptionUseCase`, not of this VO.
 */
export class PrintableMasterKey {
  /**
   * Internal 32-byte buffer. Owned, never aliased — set once in the
   * factory after a defensive copy. Reading the bytes goes through
   * `unwrap()` which also returns a defensive copy; the field
   * itself is never returned or referenced externally.
   */
  private readonly bytes: Uint8Array;

  /**
   * Canonical 61-char Bech32 rendering. Cached at construction time
   * so neither `fromString` nor `fromMasterKey` has to round-trip
   * the bytes through the library on subsequent reads.
   */
  private readonly rendered: string;

  private constructor(bytes: Uint8Array, rendered: string) {
    this.bytes = bytes;
    this.rendered = rendered;
  }

  /**
   * Builds a printable master key from raw 32-byte material.
   *
   * Used by the infrastructure layer when CSPRNG generates a fresh
   * master key during `mem.init` or during rekey. The factory
   * defensively copies the input so the caller can dispose of its
   * own buffer (e.g. by zero-filling) without affecting the VO.
   *
   * Throws `InvalidInputError` (not the checksum error) when the
   * input is structurally invalid (wrong type or wrong length);
   * checksum-class errors do not apply on the encode path — the
   * library produces the checksum.
   */
  public static fromMasterKey(bytes: Uint8Array): PrintableMasterKey {
    if (!(bytes instanceof Uint8Array)) {
      throw new InvalidInputError(
        "master key must be a Uint8Array",
        { field: "master_key" },
      );
    }
    if (bytes.length !== MASTER_KEY_LENGTH_BYTES) {
      throw new InvalidInputError(
        `master key must be exactly ${String(MASTER_KEY_LENGTH_BYTES)} bytes (got: ${String(bytes.length)})`,
        { field: "master_key" },
      );
    }
    const copy = new Uint8Array(bytes);
    const words = bech32.toWords(copy);
    const rendered = bech32.encode(HRP, words, BECH32_LIMIT);
    return new PrintableMasterKey(copy, rendered);
  }

  /**
   * Parses a user-supplied recovery key string into a VO.
   *
   * Accepts the dash-grouped human-friendly form (15 groups of 4 +
   * a trailing single character) and the canonical 61-char form
   * interchangeably; the parser strips every `-` before any
   * validation.
   *
   * Case policy: per `docs/11-seguridad-modos.md` §3, the wire
   * form is LOWERCASE only. The parser is strict about this — it
   * does NOT auto-lowercase uppercase input, because doing so
   * would silently accept strings produced by a different /
   * mistakenly capitalised renderer. Callers wishing to accept
   * uppercase input must normalise BEFORE invoking this factory.
   *
   * Throws:
   * - `InvalidInputError` on structural failures (wrong length,
   *   wrong HRP, non-lowercase, illegal chars before the Bech32
   *   library is even consulted);
   * - `PrintableMasterKeyChecksumError` on Bech32 checksum
   *   failure, carrying a best-effort classification of the
   *   user's typing error to drive a helpful CLI hint.
   *
   * Path-leak protection: neither the raw input nor the
   * dash-stripped form is interpolated into any thrown message;
   * only positional and structural data is exposed.
   */
  public static fromString(raw: string): PrintableMasterKey {
    if (typeof raw !== "string") {
      throw new InvalidInputError(
        "printable master key must be a string",
        { field: "printable_master_key" },
      );
    }
    const stripped = raw.replaceAll("-", "");

    // Strict lowercase: spec says wire form is lowercase only and
    // BIP-173 itself rejects mixed-case strings. We additionally
    // reject all-uppercase here so the printable form is truly
    // canonical (matches the renderer's output byte-for-byte).
    if (stripped !== stripped.toLowerCase()) {
      throw new InvalidInputError(
        "printable master key must be lowercase (mixed or uppercase forms are rejected)",
        { field: "printable_master_key" },
      );
    }

    if (stripped.length !== RENDERED_LENGTH) {
      throw new InvalidInputError(
        `printable master key must be exactly ${String(RENDERED_LENGTH)} characters after stripping dashes (got: ${String(stripped.length)})`,
        { field: "printable_master_key" },
      );
    }

    if (!stripped.startsWith(`${HRP}1`)) {
      throw new InvalidInputError(
        `printable master key must start with '${HRP}1'`,
        { field: "printable_master_key" },
      );
    }

    let decoded: ReturnType<typeof bech32.decode>;
    try {
      decoded = bech32.decode(stripped, BECH32_LIMIT);
    } catch (cause) {
      const classification = classifyChecksumFailure(stripped);
      if (classification.errorKind === "single") {
        throw new PrintableMasterKeyChecksumError(
          `recovery key invalid: single-character typo near position ${String(classification.errorPosition)}`,
          {
            errorKind: classification.errorKind,
            errorPosition: classification.errorPosition,
          },
          cause,
        );
      }
      if (classification.errorKind === "transposition") {
        throw new PrintableMasterKeyChecksumError(
          `recovery key invalid: adjacent characters swapped near position ${String(classification.errorPosition)}`,
          {
            errorKind: classification.errorKind,
            errorPosition: classification.errorPosition,
          },
          cause,
        );
      }
      throw new PrintableMasterKeyChecksumError(
        "recovery key invalid: 2+ uncorrectable errors, please re-check the source",
        { errorKind: classification.errorKind },
        cause,
      );
    }

    if (decoded.prefix !== HRP) {
      throw new InvalidInputError(
        `printable master key HRP mismatch (expected '${HRP}')`,
        { field: "printable_master_key" },
      );
    }

    const decodedBytes = bech32.fromWords(decoded.words);
    if (decodedBytes.length !== MASTER_KEY_LENGTH_BYTES) {
      // Bech32 padding edge-case: 52 data chars CAN decode to 32
      // bytes only when the trailing 5-bit symbol carries the
      // single padding bit set to zero. A non-conforming input
      // could theoretically decode to a different byte length even
      // after passing the checksum (this requires the BCH check to
      // accept a malformed payload, which is unreachable in
      // practice given the polynomial, but we defend in depth).
      throw new InvalidInputError(
        `printable master key payload must decode to ${String(MASTER_KEY_LENGTH_BYTES)} bytes (got: ${String(decodedBytes.length)})`,
        { field: "printable_master_key" },
      );
    }

    const bytes = Uint8Array.from(decodedBytes);
    return new PrintableMasterKey(bytes, stripped);
  }

  /**
   * Returns the canonical (dash-less, lowercase) 61-character
   * Bech32 rendering. Use this when the consumer needs the raw
   * wire form (e.g. a re-encode round-trip in a test, or a
   * non-human transport). For human display in the CLI use
   * `toRenderedWithGrouping()` instead.
   *
   * Note: unlike `MasterKey.toString()`, this does NOT redact —
   * the printable master key is the public recovery form by
   * design. Secrecy is enforced by the surrounding code paths
   * (stdout only, never logs, never MCP), not by this VO.
   */
  public toString(): string {
    return this.rendered;
  }

  /**
   * Returns the human-friendly rendering with `-` inserted every
   * 4 chars (15 full groups + 1 trailing group of 1 character).
   * This is the form printed by the CLI during `mem.init` and
   * `recall export-key`.
   */
  public toRenderedWithGrouping(): string {
    return applyCosmeticGrouping(this.rendered);
  }

  /**
   * SAFE BY CONSTRUCTION. Returns the redaction sentinel rather
   * than the canonical form. Logging frameworks (pino, winston)
   * invoke `toJSON` automatically via `JSON.stringify`, so the
   * rendered form is never accidentally written to log files even
   * when this VO is part of a larger object that gets dumped.
   */
  public toJSON(): string {
    return REDACTED_JSON_REPRESENTATION;
  }

  /**
   * THE ONLY supported way to obtain the wrapped 32-byte master
   * key buffer. Returns a fresh defensive copy on every call so
   * mutations by the caller cannot affect the VO.
   *
   * Authorised callers (audit grep target — `grep -R "\.unwrap("
   * src/`):
   * - `UnlockEncryptionUseCase` — to feed SQLCipher when the user
   *   provided a recovery key.
   * - `ExportMasterKeyUseCase` — to round-trip through a
   *   `MasterKey` VO before re-export under a passphrase.
   *
   * Every other caller is a potential leak and MUST be reviewed
   * before merging.
   */
  public unwrap(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.bytes);
  }

  /**
   * Constant-time equality over the wrapped bytes. Iterates the
   * whole buffer regardless of the first mismatch so a timing
   * side-channel cannot recover the key one byte at a time.
   */
  public equals(other: PrintableMasterKey): boolean {
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

  /** Exposes the configured key length for documentation / tests. */
  public static lengthBytes(): number {
    return MASTER_KEY_LENGTH_BYTES;
  }

  /** Exposes the canonical rendered length for documentation / tests. */
  public static renderedLength(): number {
    return RENDERED_LENGTH;
  }

  /** Exposes the HRP for documentation / tests. */
  public static hrp(): string {
    return HRP;
  }

  /** Exposes the redaction sentinel for documentation / tests. */
  public static redactedJsonRepresentation(): string {
    return REDACTED_JSON_REPRESENTATION;
  }
}
