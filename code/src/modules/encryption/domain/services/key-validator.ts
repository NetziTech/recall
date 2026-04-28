import type { KeyValidatorBlob } from "../value-objects/key-validator-blob.ts";
import type { MasterKey } from "../value-objects/master-key.ts";

/**
 * Driven port (output port) responsible for verifying that a
 * candidate `MasterKey` decrypts the workspace's `KeyValidatorBlob`
 * to the expected sentinel.
 *
 * The reference adapter performs the AEAD decryption with the same
 * primitive used by the envelope cipher (`EnvelopeCipher`) and then
 * delegates the byte comparison to
 * `KeyValidatorBlob.matches(decrypted)` (which is constant-time).
 * Living the implementation in `infrastructure/crypto/` keeps the
 * domain pluggable.
 *
 * Why a separate port (instead of folding it into `EnvelopeCipher`):
 * - The aggregate's `unlockWith(...)` operation is
 *   semantically *validation*, not unwrapping; the input is the
 *   already-decoded master key (the unwrap happened upstream when
 *   the application layer chose which envelope to try). Modelling
 *   it as a distinct service keeps each adapter focused on a single
 *   responsibility (SRP).
 * - Validation is the cheap operation (small blob, ~1ms).
 *   `EnvelopeCipher.unwrap` is also cheap, but the conceptual
 *   distinction matters for the architecture: validation is the
 *   ORACLE that says "is this key the right one?", while unwrapping
 *   is the MECHANICS that produces a candidate.
 *
 * Contract:
 * - `validate` is a pure function over its inputs: same blob, same
 *   key → same result, every time.
 * - The implementation MUST run in constant time with respect to
 *   the candidate key bytes. The byte-by-byte comparison inside
 *   `KeyValidatorBlob.matches` already enforces that downstream;
 *   the adapter only has to refrain from leaking timing in its
 *   own AEAD call.
 * - The implementation MUST treat both inputs as secret material
 *   (no logging, no telemetry, no caching).
 * - On AEAD authentication failure (the more common failure mode:
 *   a wrong key produces a tag that does not verify) the adapter
 *   MUST return `false` (not throw): this is an expected outcome,
 *   not an exceptional condition. The domain raises
 *   `KeyValidationFailedError` from the aggregate when needed.
 */
export interface KeyValidator {
  /**
   * Returns `true` iff the candidate `MasterKey` correctly
   * decrypts the validator blob to its expected sentinel.
   * Returns `false` for any negative outcome (wrong key, tampered
   * blob, etc.); see contract above.
   */
  validate(blob: KeyValidatorBlob, candidate: MasterKey): Promise<boolean>;
}
