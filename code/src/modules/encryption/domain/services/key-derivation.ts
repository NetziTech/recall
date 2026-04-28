import type { DerivedKey } from "../value-objects/derived-key.ts";
import type { KdfParams } from "../value-objects/kdf-params.ts";
import type { Passphrase } from "../value-objects/passphrase.ts";

/**
 * Driven port (output port) responsible for converting a
 * user-supplied `Passphrase` into a `DerivedKey` using the KDF
 * parameters carried by the workspace.
 *
 * The reference adapter wraps `argon2id` (see
 * `docs/06-stack-tecnico.md` §4-§5 and `docs/11-seguridad-modos.md`
 * §3 / §7). Living the implementation in `infrastructure/crypto/`
 * keeps the domain pluggable: a future adapter could use an HSM, a
 * libsodium backend, or a hardware-accelerated argon2 — the domain
 * does not know and does not care, as long as the contract below
 * holds.
 *
 * Contract:
 * - `derive` is a pure function: given the same `(passphrase,
 *   params)` pair it MUST always return the same `DerivedKey` byte
 *   for byte. The unlock flow depends on this determinism (the
 *   key cached in HOME is exactly the bytes that re-deriving the
 *   passphrase produces).
 * - The implementation SHOULD run in constant time with respect
 *   to the passphrase content. argon2id satisfies this naturally;
 *   the contract names it explicitly so reviewers reject any
 *   adapter that, e.g., short-circuits on length checks revealing
 *   the passphrase length via timing.
 * - The implementation MUST honour `params.memoryKib`,
 *   `params.iterations` and `params.parallelism` (no silent
 *   downgrade to "weaker but faster" defaults). The domain
 *   already enforces minimum strength in `KdfParams`; the adapter
 *   only has to forward the values to the underlying primitive.
 * - The implementation MUST treat both inputs as secret material:
 *   no logging, no telemetry, no caching that survives the call.
 *   The only output is the `DerivedKey`.
 *
 * Errors:
 * - The contract does NOT specify an error type. The expected
 *   failure modes (out-of-memory, missing native binding, etc.)
 *   are infrastructure concerns and are surfaced as plain `Error`
 *   instances from the adapter; the application layer wraps them
 *   into a domain-level error if it needs to.
 */
export interface KeyDerivation {
  /**
   * Derives a key from the supplied passphrase using `params`.
   * Returns a freshly built `DerivedKey`. Mutating the returned
   * value is impossible (the VO is immutable); the adapter is
   * still responsible for zeroing any intermediate buffers it
   * uses internally.
   */
  derive(passphrase: Passphrase, params: KdfParams): Promise<DerivedKey>;
}
