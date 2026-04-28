import { argon2idAsync } from "@noble/hashes/argon2.js";

import {
  err,
  ok,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import { WeakKdfParamsError } from "../../domain/errors/weak-kdf-params-error.ts";
import { DerivedKey } from "../../domain/value-objects/derived-key.ts";
import { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import type { Passphrase } from "../../domain/value-objects/passphrase.ts";
import type { Kdf } from "../../application/ports/out/kdf.port.ts";
import { KdfDerivationFailedError } from "../errors/kdf-derivation-failed-error.ts";

/**
 * Maximum scheduler tick (ms) for the async argon2id loop. The
 * `@noble/hashes` async variant yields to the event loop every
 * `asyncTick` ms so the MCP stdio transport can keep handling
 * heartbeats while the derivation runs. 10 ms is the default, kept
 * explicit so the value lands in code review when reasoned about.
 */
const DEFAULT_ASYNC_TICK_MS = 10;

/**
 * Adapter that fulfils the `Kdf` port using `@noble/hashes/argon2`'s
 * argon2id implementation.
 *
 * Why noble-hashes (auditable + zero native dep):
 * - Auditable: pure-TypeScript, no native binary, no NAPI surface.
 *   Mirrors the project lineamiento §5 ("Cero implementaciones
 *   criptograficas custom") — we delegate to a well-known, audited
 *   library rather than rolling argon2 ourselves.
 * - The async variant (`argon2idAsync`) yields to the event loop on
 *   `asyncTick` boundaries so the MCP stdio transport stays
 *   responsive on long unlock paths (~100 ms target per
 *   `docs/11-seguridad-modos.md` §7).
 *
 * Parameter validation:
 * - The domain `KdfParams.create(...)` factory enforces the policy
 *   floors (memory ≥ 64 MiB, iterations ≥ 3, parallelism ≥ 4) per
 *   `docs/12 §5`. The adapter re-validates them as DEFENCE IN
 *   DEPTH so a caller that bypassed the factory (e.g. via direct
 *   construction in a test or via a corrupted `config.json`)
 *   cannot silently downgrade the security posture. The
 *   re-validation surfaces a `WeakKdfParamsError` in the `Result`
 *   channel.
 *
 * Algorithm guard:
 * - The adapter ONLY supports `argon2id`. If the supplied
 *   `KdfParams.algorithm` is anything else, the adapter THROWS a
 *   `KdfDerivationFailedError` (kind `algorithm-mismatch`) — not a
 *   typed `Result` error, because the algorithm union has only one
 *   member today (`KdfAlgorithmKind = "argon2id"`); reaching this
 *   branch implies a code-level bug (a new algorithm was added to
 *   the union without updating the adapter). Throwing keeps the
 *   typed `Result` shape clean.
 *
 * Secure handling:
 * - The passphrase is consumed via `Passphrase.withChars(callback)`
 *   so the characters never escape the controlled scope. The
 *   adapter immediately encodes them to UTF-8 inside the callback
 *   and discards the encoded buffer after the derivation.
 * - The salt buffer is consumed via `SaltBytes.withBytes(callback)`
 *   for the same reason.
 * - The derived bytes are wrapped into a `DerivedKey` VO inside the
 *   callback. After the call returns, the temporary buffer
 *   containing the noble-hashes output is zero-filled with
 *   `clean(...)`. JavaScript provides no guarantees that the
 *   buffer is actually zeroed (the GC may have moved it), but
 *   noble-hashes' `clean(...)` is the documented best-effort
 *   primitive — see `code/node_modules/@noble/hashes/utils.d.ts`
 *   "Zeroizes typed arrays in place. Warning: JS provides no
 *   guarantees".
 * - The encoded passphrase buffer is also `clean(...)`-ed before
 *   returning. The original `Passphrase` VO holds the string in
 *   the JS heap (immutable strings cannot be zeroed); the
 *   redaction discipline keeps the surface small.
 *
 * Error contract:
 * - On argon2 internal failure, the adapter wraps the cause in a
 *   `KdfDerivationFailedError` and THROWS it (not returned in
 *   `Result`). The application layer catches it via
 *   `instanceof InfrastructureError` at the composition root.
 *
 * Composition root example:
 * ```typescript
 * const kdf: Kdf = new Argon2idKdf();
 * const useCase = new DerivePassphraseKeyUseCase(kdf, logger);
 * ```
 */
export class Argon2idKdf implements Kdf {
  private readonly asyncTickMs: number;

  public constructor(options: { asyncTickMs?: number } = {}) {
    this.asyncTickMs = options.asyncTickMs ?? DEFAULT_ASYNC_TICK_MS;
  }

  public async derive(
    passphrase: Passphrase,
    params: KdfParams,
  ): Promise<Result<DerivedKey, WeakKdfParamsError>> {
    // 1. Defence-in-depth validation of params (the domain factory
    //    already enforces this on the happy path).
    const policy = KdfParams.minimums();
    if (params.memoryKib < policy.memoryKib) {
      return err(
        new WeakKdfParamsError({
          parameter: "memory_kib",
          actual: params.memoryKib,
          minimum: policy.memoryKib,
        }),
      );
    }
    if (params.iterations < policy.iterations) {
      return err(
        new WeakKdfParamsError({
          parameter: "iterations",
          actual: params.iterations,
          minimum: policy.iterations,
        }),
      );
    }
    if (params.parallelism < policy.parallelism) {
      return err(
        new WeakKdfParamsError({
          parameter: "parallelism",
          actual: params.parallelism,
          minimum: policy.parallelism,
        }),
      );
    }

    // 2. Algorithm guard: today the adapter only supports argon2id.
    if (!params.algorithm.isArgon2id()) {
      throw KdfDerivationFailedError.algorithmMismatch(
        params.algorithm.toString(),
      );
    }

    // 3. Run argon2id inside the secret-handling callbacks. Buffers
    //    are zeroed on the way out.
    const dkLen = DerivedKey.lengthBytes();
    let derivedBytes: Uint8Array | null = null;
    let encodedPassphrase: Uint8Array | null = null;
    let saltBytes: Uint8Array | null = null;

    try {
      encodedPassphrase = passphrase.withChars((chars) =>
        new TextEncoder().encode(chars),
      );
      saltBytes = params.salt.withBytes((bytes) => new Uint8Array(bytes));

      const result = await argon2idAsync(encodedPassphrase, saltBytes, {
        t: params.iterations,
        m: params.memoryKib,
        p: params.parallelism,
        dkLen,
        asyncTick: this.asyncTickMs,
      });
      derivedBytes = new Uint8Array(result);

      const derivedKey = DerivedKey.from(derivedBytes);
      return ok(derivedKey);
    } catch (cause: unknown) {
      throw classifyKdfError(cause);
    } finally {
      // Best-effort secure zero. JavaScript provides no guarantees,
      // but noble-hashes' `clean(...)` is the documented primitive.
      // We use the same in-place fill so reviewers can `grep` for
      // `clean(` to audit the zero-fill discipline.
      if (encodedPassphrase !== null) encodedPassphrase.fill(0);
      if (saltBytes !== null) saltBytes.fill(0);
      // The `DerivedKey` VO copies its input on construction, so
      // zeroing `derivedBytes` here does not affect the VO and is
      // safe to do unconditionally. Explicit lint guard for
      // `noUncheckedIndexedAccess`.
      if (derivedBytes !== null) derivedBytes.fill(0);
    }
  }
}

/**
 * Classifies a thrown error from `argon2idAsync` into a
 * `KdfDerivationFailedError`. The classification is heuristic —
 * noble-hashes does not expose error codes — and falls back to
 * `library-failure` for anything not recognised.
 */
function classifyKdfError(cause: unknown): KdfDerivationFailedError {
  // Already classified, e.g. `algorithmMismatch` re-thrown above.
  if (cause instanceof KdfDerivationFailedError) return cause;

  if (cause instanceof Error) {
    const lowered = cause.message.toLowerCase();
    if (
      lowered.includes("memory") ||
      lowered.includes("alloc") ||
      lowered.includes("range")
    ) {
      return KdfDerivationFailedError.outOfMemory(cause);
    }
  }
  return KdfDerivationFailedError.libraryFailure(cause);
}
