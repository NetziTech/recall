import { webcrypto } from "node:crypto";

import type { KeyValidator } from "../../domain/services/key-validator.ts";
import type { KeyValidatorBlob } from "../../domain/value-objects/key-validator-blob.ts";
import type { MasterKey } from "../../domain/value-objects/master-key.ts";
import { AeadFailedError } from "../errors/aead-failed-error.ts";

const AES_GCM_TAG_LENGTH_BITS = 128;
const AES_GCM_TAG_LENGTH_BYTES = AES_GCM_TAG_LENGTH_BITS / 8;
const AES_GCM_NONCE_LENGTH_BYTES = 12;

/**
 * Adapter that fulfils the `KeyValidator` domain port using Node 20+
 * Web Crypto AES-256-GCM (`node:crypto` `webcrypto`).
 *
 * Why this is a separate adapter from `AesGcmEnvelopeCipher`:
 * - `EnvelopeCipher.unwrap` returns the unwrapped `MasterKey` and
 *   THROWS on any AEAD failure (including a wrong key). The caller
 *   has to catch `AeadFailedError` to handle "wrong key".
 * - `KeyValidator.validate` returns a `boolean` and NEVER throws on
 *   AEAD authentication failure (the domain contract is explicit:
 *   "MUST return `false` (not throw)"). The application layer
 *   relies on this contract so it can fold validate calls into
 *   straight-line code.
 *
 * Folding both behaviours into one adapter is possible but harms
 * SOLID-SRP: the wrapper would need a `mode: "throws" | "returns-false"`
 * flag, which is a code smell.
 *
 * Contract:
 * - On success (tag verifies AND decrypted plaintext matches the
 *   blob's expected sentinel): returns `true`.
 * - On AEAD authentication failure: returns `false`.
 * - On host-runtime failure (no `crypto.subtle`, library exception):
 *   THROWS `AeadFailedError`. These are operational failures of the
 *   host, not a "wrong key" outcome.
 *
 * Security invariants:
 * - The adapter NEVER logs ciphertext, tag, IV, master key bytes or
 *   plaintext.
 * - The byte comparison is delegated to
 *   `KeyValidatorBlob.matches(...)` which is constant-time.
 */
export class AesGcmKeyValidator implements KeyValidator {
  public async validate(
    blob: KeyValidatorBlob,
    candidate: MasterKey,
  ): Promise<boolean> {
    const subtle = getSubtle();

    const cryptoKey = await candidate.withBytes((bytes) =>
      importMasterKey(subtle, bytes),
    );

    const ciphertext = blob.withCiphertext((b) => new Uint8Array(b));
    const iv = blob.withIv((b) => new Uint8Array(b));
    const tag = blob.withTag((b) => new Uint8Array(b));

    if (iv.length !== AES_GCM_NONCE_LENGTH_BYTES) {
      throw AeadFailedError.invalidBufferSize(
        "iv",
        AES_GCM_NONCE_LENGTH_BYTES,
        iv.length,
      );
    }
    if (tag.length !== AES_GCM_TAG_LENGTH_BYTES) {
      throw AeadFailedError.invalidBufferSize(
        "tag",
        AES_GCM_TAG_LENGTH_BYTES,
        tag.length,
      );
    }

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);

    let plaintextBuffer: ArrayBuffer;
    try {
      plaintextBuffer = await subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          tagLength: AES_GCM_TAG_LENGTH_BITS,
        },
        cryptoKey,
        combined,
      );
    } catch {
      // Web Crypto's decrypt rejects with a generic `OperationError`
      // on tag mismatch. The contract for `KeyValidator.validate`
      // says explicitly "On AEAD authentication failure ... MUST
      // return `false` (not throw)" — this is the canonical "wrong
      // candidate key" outcome and the aggregate's `unlockWith`
      // relies on it.
      return false;
    }

    const plaintextView = new Uint8Array(plaintextBuffer);
    try {
      return blob.matches(plaintextView);
    } finally {
      plaintextView.fill(0);
    }
  }
}

function getSubtle(): webcrypto.SubtleCrypto {
  const subtle: unknown = webcrypto.subtle;
  if (typeof subtle !== "object" || subtle === null) {
    throw AeadFailedError.subtleNotAvailable();
  }
  return webcrypto.subtle;
}

async function importMasterKey(
  subtle: webcrypto.SubtleCrypto,
  bytes: Uint8Array,
): Promise<webcrypto.CryptoKey> {
  try {
    return await subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
  } catch (cause: unknown) {
    throw AeadFailedError.libraryFailure(cause);
  }
}
