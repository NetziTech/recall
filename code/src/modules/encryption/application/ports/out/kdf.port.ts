import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { WeakKdfParamsError } from "../../../domain/errors/weak-kdf-params-error.ts";
import type { DerivedKey } from "../../../domain/value-objects/derived-key.ts";
import type { KdfParams } from "../../../domain/value-objects/kdf-params.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Driven (output) port owned by the encryption application layer that
 * derives a `DerivedKey` from a `Passphrase` using a `KdfParams` spec.
 *
 * Why this port lives here (and NOT in `shared/application/ports/`):
 * - The contract consumes value objects from `encryption/domain/`
 *   (`Passphrase`, `KdfParams`, `DerivedKey`). A `shared` port could
 *   not import them without inverting the dependency graph
 *   (`docs/12 §1.5` Regla 2). The orchestrator decided in Fase 2 to
 *   keep this port co-located with the encryption module
 *   (HANDOFF.md §6.6 D-018, B-006).
 * - The reference adapter is `Argon2idKdf`
 *   (`modules/encryption/infrastructure/kdf/argon2id-kdf.ts`) which
 *   wraps `@noble/hashes/argon2`'s async argon2id implementation.
 *
 * Contract:
 * - `derive(passphrase, params)` is a (effectively) pure function:
 *   given the same `(passphrase, params)` pair it MUST always return
 *   the same `DerivedKey` byte for byte. The unlock flow depends on
 *   this determinism (the cached key in HOME is exactly the bytes
 *   that re-deriving the passphrase produces, see
 *   `docs/11-seguridad-modos.md` §7).
 * - The implementation MUST honour `params.memoryKib`,
 *   `params.iterations` and `params.parallelism` (no silent
 *   downgrade). The domain enforces minimum strength via `KdfParams`
 *   factory; the adapter only forwards the values to the underlying
 *   primitive.
 * - The implementation MUST run in (effectively) constant time with
 *   respect to the passphrase content. argon2id satisfies this
 *   naturally; the contract names it explicitly so reviewers reject
 *   any adapter that, e.g., short-circuits on length checks revealing
 *   the passphrase length via timing.
 * - The implementation MUST treat both inputs as secret material: no
 *   logging, no telemetry, no caching that survives the call. The
 *   only output is the `DerivedKey` (or a typed error / thrown
 *   `EncryptionInfrastructureError`).
 *
 * Failure modes:
 * - `WeakKdfParamsError` (Result channel): the supplied `params`
 *   would force the adapter to run with weaker-than-policy
 *   parameters. Returned as `err(...)` because the upstream caller
 *   (e.g. composition root parsing `config.json`) can recover by
 *   surfacing a precise message. NOTE: the domain-level
 *   `KdfParams.create(...)` factory already enforces the floor, so
 *   this is a defensive belt-and-suspenders branch the adapter
 *   activates only if a caller bypassed the factory (e.g. through
 *   a direct constructor call patched in tests).
 * - `EncryptionInfrastructureError` subclasses (THROWN):
 *   `KdfDerivationFailedError` for primitive-level failures (OOM,
 *   library exception, algorithm mismatch). Thrown rather than
 *   returned to keep the application layer free of any
 *   `infrastructure/errors/` import (the layering rule of
 *   `docs/12 §1.1` forbids `application → infrastructure`). The
 *   composition root catches them via `instanceof InfrastructureError`.
 */
export interface Kdf {
  derive(
    passphrase: Passphrase,
    params: KdfParams,
  ): Promise<Result<DerivedKey, WeakKdfParamsError>>;
}
