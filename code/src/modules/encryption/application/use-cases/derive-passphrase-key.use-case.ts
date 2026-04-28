import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { Result } from "../../../../shared/domain/types/result.ts";
import type { WeakKdfParamsError } from "../../domain/errors/weak-kdf-params-error.ts";
import type { DerivedKey } from "../../domain/value-objects/derived-key.ts";
import type { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import type { Passphrase } from "../../domain/value-objects/passphrase.ts";
import type { DerivePassphraseKey } from "../ports/in/derive-passphrase-key.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";

/**
 * Use case: derive a `DerivedKey` from a `Passphrase` + `KdfParams`.
 *
 * Today the use case is a thin pass-through over the `Kdf` driven
 * port, plus a logging hook. The split exists so the application
 * layer can grow concerns later (timing instrumentation, retry on
 * transient failures, in-process cache for the duration of an unlock
 * roundtrip) without rippling through the input-port consumers.
 *
 * Why a class (not a free function):
 * - The composition root injects the `Kdf` adapter and the `Logger`
 *   exactly once at server start-up. A function would force callers
 *   to plumb both arguments at every call site.
 *
 * Security:
 * - The use case logs the *event* of a derivation (debug level) but
 *   NEVER the passphrase length, the derived bytes or the
 *   `KdfParams.salt`. The KDF parameters (algorithm, memory,
 *   iterations, parallelism) ARE logged because they are public.
 * - Primitive-level failures (`KdfDerivationFailedError` from
 *   `infrastructure/errors/`) propagate as exceptions; the use case
 *   does not catch them so the composition root can apply its
 *   `instanceof InfrastructureError` policy.
 */
export class DerivePassphraseKeyUseCase implements DerivePassphraseKey {
  public constructor(
    private readonly kdf: Kdf,
    private readonly logger: Logger,
  ) {}

  public async derive(input: {
    passphrase: Passphrase;
    params: KdfParams;
  }): Promise<Result<DerivedKey, WeakKdfParamsError>> {
    this.logger.debug(
      {
        algorithm: input.params.algorithm.toString(),
        memoryKib: input.params.memoryKib,
        iterations: input.params.iterations,
        parallelism: input.params.parallelism,
      },
      "deriving key from passphrase",
    );

    return this.kdf.derive(input.passphrase, input.params);
  }
}
