/**
 * Driven (output) port providing a CSPRNG byte source.
 *
 * Why this port lives in the encryption module (and not in `shared/`):
 * - The only callers in the MVP are the encryption use cases
 *   (initialise: master key + salt + IV; rotate: new master key; AEAD
 *   wrap: nonce). The brief carve-out in HANDOFF.md §6.6 D-018 keeps
 *   crypto-related output ports co-located with their consumer.
 * - The shared `IdGenerator` port already provides the *uuid*
 *   primitive but it is intentionally typed as a UUID v7 producer,
 *   NOT a generic byte source — folding both responsibilities into
 *   one port would violate ISP.
 *
 * Contract:
 * - `next(length)` returns a freshly-allocated `Uint8Array` of
 *   exactly `length` bytes drawn from a cryptographically secure
 *   pseudo-random number generator (the host's
 *   `crypto.getRandomValues` on Node 20+).
 * - `length` MUST be a positive finite integer. Adapters MUST refuse
 *   `0`, negative values, fractional values and Infinity.
 * - The returned buffer is owned by the caller (the adapter does
 *   not retain a reference). Callers free to mutate it.
 * - The adapter MUST NOT log the produced bytes anywhere.
 *
 * Reference adapter:
 * - `WebCryptoRandomBytes`
 *   (`modules/encryption/infrastructure/random/web-crypto-random-bytes.ts`)
 *   delegates to the global `crypto.getRandomValues` exposed by the
 *   Node 20 runtime (web-crypto compliant).
 */
export interface RandomBytes {
  next(length: number): Uint8Array;
}
