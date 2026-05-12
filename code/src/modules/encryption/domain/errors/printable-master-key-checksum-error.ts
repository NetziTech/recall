import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Classification of the typing error detected by the BCH checksum.
 *
 * - `single`     — exactly one character was modified relative to a
 *                  valid neighbour. BCH detected it; the user almost
 *                  certainly mistyped one character.
 * - `transposition` — two adjacent characters were swapped. This is
 *                  the second most frequent transcription mistake and
 *                  Bech32's polynomial detects it by design.
 * - `unrecoverable` — three or more errors, or a structural failure
 *                  (mixed case, wrong length, wrong HRP, etc.). The
 *                  user should re-type the key from the source of
 *                  truth (paper backup, password manager); we cannot
 *                  guess what they meant.
 *
 * The classification is best-effort and is used ONLY to render a
 * helpful error message in the CLI. It is NOT used to decide whether
 * to attempt an unlock — every value here implies HARD REJECT (see
 * `docs/11-seguridad-modos.md` §3 "Comportamiento ante checksum-fail").
 */
export type PrintableMasterKeyChecksumErrorKind =
  | "single"
  | "transposition"
  | "unrecoverable";

/**
 * Details payload attached to a `PrintableMasterKeyChecksumError`.
 *
 * Both fields are optional because the underlying `bech32` library
 * (BIP-173) does NOT expose the error position or the number of
 * corrupted symbols — it only signals checksum pass/fail. The domain
 * runs a bounded heuristic (single-bit-flip and adjacent-swap brute
 * force on the 61-character ciphertext) to recover the most likely
 * classification without reimplementing BCH ourselves.
 *
 * Security note: NEITHER field carries any byte of master-key
 * material, and the position is a position INSIDE the 61-character
 * Bech32 string, not inside the 32-byte key. It is safe to log.
 */
export interface PrintableMasterKeyChecksumErrorDetails {
  /**
   * 0-indexed position inside the 61-character canonical
   * (dash-stripped, lowercase) Bech32 string where the most likely
   * single typo was found. Present only when `errorKind === "single"`
   * or `errorKind === "transposition"`.
   */
  readonly errorPosition?: number;

  /**
   * Heuristic classification of the typing error. See
   * `PrintableMasterKeyChecksumErrorKind` for semantics.
   */
  readonly errorKind?: PrintableMasterKeyChecksumErrorKind;
}

/**
 * Raised by `PrintableMasterKey.fromString` when the Bech32 checksum
 * does not validate, or when the structural invariants (HRP, length,
 * alphabet, case) are violated.
 *
 * Maps to the same JSON-RPC code as a wrong-key (`-32108 INVALID_KEY`)
 * because, from the wire's perspective, a candidate recovery key that
 * fails its own integrity check cannot be a valid key. The CLI
 * distinguishes "wrong key" from "typo in recovery key" by inspecting
 * the `errorKind` field of the attached details.
 *
 * Path-leak protection (NON-NEGOTIABLE): neither the rendered
 * Bech32 string nor any candidate buffer may be interpolated into
 * `message` or stored on the instance. The constructor only accepts
 * the classification fields (`errorPosition`, `errorKind`) which by
 * construction do not carry secret material. The original library
 * exception is preserved as `cause` (non-enumerable on
 * `DomainError`), so structured logs that respect `JSON.stringify`
 * never serialise it.
 *
 * See `docs/11-seguridad-modos.md` §3 ("Formato de la clave de
 * recuperacion") for the rendering / parsing spec this error guards.
 */
export class PrintableMasterKeyChecksumError extends EncryptionDomainError {
  public readonly code = "printable-master-key-checksum-mismatch";
  public readonly jsonRpcCode: number = JsonRpcErrorCodes.INVALID_KEY;

  /**
   * Heuristic classification of the failure. See
   * `PrintableMasterKeyChecksumErrorKind` for the enum semantics.
   *
   * Marked `readonly` so callers cannot rewrite the classification
   * after construction.
   */
  public readonly errorKind: PrintableMasterKeyChecksumErrorKind | undefined;

  /**
   * 0-indexed position of the most likely typo inside the canonical
   * 61-character Bech32 string, when the heuristic can pinpoint it.
   */
  public readonly errorPosition: number | undefined;

  public constructor(
    message: string,
    details: PrintableMasterKeyChecksumErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause);
    this.errorKind = details.errorKind;
    this.errorPosition = details.errorPosition;
  }
}
