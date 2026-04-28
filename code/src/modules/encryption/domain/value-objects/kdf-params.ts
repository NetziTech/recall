import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { WeakKdfParamsError } from "../errors/weak-kdf-params-error.ts";
import { KdfAlgorithm } from "./kdf-algorithm.ts";
import type { SaltBytes } from "./salt-bytes.ts";

/**
 * Minimum argon2id parameters enforced by the domain.
 *
 * Pinned by `docs/11-seguridad-modos.md` §3 and the project lineamiento
 * in `docs/12-lineamientos-arquitectura.md` §5 ("Reglas de seguridad"):
 * argon2id with at least 64 MiB of memory, 3 passes (iterations) and
 * 4 lanes (parallelism). These floors mirror OWASP 2024 guidance for
 * argon2id used as a password-based KDF and prevent any caller from
 * silently downgrading the encryption posture by writing weaker
 * params into `config.json`.
 */
const MIN_MEMORY_KIB = 65536; // 64 MiB
const MIN_ITERATIONS = 3;
const MIN_PARALLELISM = 4;

/**
 * Recommended defaults applied by `KdfParams.defaults(salt)`. These
 * match the literal example shipped in `docs/03-modelo-datos.md` §2:
 *
 *   `{ memory_kib: 65536, iterations: 3, parallelism: 4 }`
 *
 * The defaults are chosen so the unlock latency (~100ms on a 2024
 * laptop) stays inside the budget documented in
 * `docs/11-seguridad-modos.md` §7 ("Asi se valida sin abrir la DB
 * completa, en < 100ms").
 */
const DEFAULT_MEMORY_KIB = 65536;
const DEFAULT_ITERATIONS = 3;
const DEFAULT_PARALLELISM = 4;

/**
 * Value object representing the parameters fed into the KDF when
 * deriving a key from a passphrase.
 *
 * Mirrors `kdf_params` from the encrypted-mode config documented in
 * `docs/03-modelo-datos.md` §2 and `docs/11-seguridad-modos.md` §3 / §7:
 *
 * ```json
 * {
 *   "memory_kib": 65536,
 *   "iterations": 3,
 *   "parallelism": 4,
 *   "salt_b64": "..."
 * }
 * ```
 *
 * The KDF computation itself lives in the infrastructure adapter
 * (`Argon2idKDF`); this VO carries only the *spec*, so the domain can
 * keep cryptographic behaviour pluggable while still enforcing minimum
 * strength.
 *
 * Invariants:
 * - `memoryKib >= MIN_MEMORY_KIB` (64 MiB minimum).
 * - `iterations >= MIN_ITERATIONS` (3 passes minimum).
 * - `parallelism >= MIN_PARALLELISM` (4 lanes minimum).
 * - `algorithm` and `salt` already enforce their own invariants by
 *   construction.
 * - All numeric fields are positive finite integers.
 *
 * Equality:
 * - Two `KdfParams` instances are equal iff every field is equal
 *   (delegates to each VO's `equals` for `algorithm` and `salt`).
 */
export class KdfParams {
  private constructor(
    public readonly algorithm: KdfAlgorithm,
    public readonly memoryKib: number,
    public readonly iterations: number,
    public readonly parallelism: number,
    public readonly salt: SaltBytes,
  ) {}

  /**
   * Builds a `KdfParams` from already-parsed components. The
   * application layer is responsible for constructing each VO from the
   * raw JSON before delegating here.
   */
  public static create(input: {
    algorithm: KdfAlgorithm;
    memoryKib: number;
    iterations: number;
    parallelism: number;
    salt: SaltBytes;
  }): KdfParams {
    KdfParams.assertPositiveInteger(input.memoryKib, "kdf_params.memory_kib");
    KdfParams.assertPositiveInteger(input.iterations, "kdf_params.iterations");
    KdfParams.assertPositiveInteger(
      input.parallelism,
      "kdf_params.parallelism",
    );

    if (input.memoryKib < MIN_MEMORY_KIB) {
      throw new WeakKdfParamsError({
        parameter: "memory_kib",
        actual: input.memoryKib,
        minimum: MIN_MEMORY_KIB,
      });
    }
    if (input.iterations < MIN_ITERATIONS) {
      throw new WeakKdfParamsError({
        parameter: "iterations",
        actual: input.iterations,
        minimum: MIN_ITERATIONS,
      });
    }
    if (input.parallelism < MIN_PARALLELISM) {
      throw new WeakKdfParamsError({
        parameter: "parallelism",
        actual: input.parallelism,
        minimum: MIN_PARALLELISM,
      });
    }

    return new KdfParams(
      input.algorithm,
      input.memoryKib,
      input.iterations,
      input.parallelism,
      input.salt,
    );
  }

  /**
   * Returns a `KdfParams` instance using the recommended defaults
   * (64 MiB / 3 iter / 4 lanes / argon2id). The salt MUST be supplied
   * by the caller because it is per-workspace and produced by a CSPRNG
   * in the infrastructure layer.
   */
  public static defaults(salt: SaltBytes): KdfParams {
    return new KdfParams(
      KdfAlgorithm.argon2id(),
      DEFAULT_MEMORY_KIB,
      DEFAULT_ITERATIONS,
      DEFAULT_PARALLELISM,
      salt,
    );
  }

  /** Exposes the configured floors for documentation/tests. */
  public static minimums(): {
    readonly memoryKib: number;
    readonly iterations: number;
    readonly parallelism: number;
  } {
    return {
      memoryKib: MIN_MEMORY_KIB,
      iterations: MIN_ITERATIONS,
      parallelism: MIN_PARALLELISM,
    };
  }

  public equals(other: KdfParams): boolean {
    if (this === other) return true;
    return (
      this.algorithm.equals(other.algorithm) &&
      this.memoryKib === other.memoryKib &&
      this.iterations === other.iterations &&
      this.parallelism === other.parallelism &&
      this.salt.equals(other.salt)
    );
  }

  // -- internals ------------------------------------------------------------

  private static assertPositiveInteger(value: number, field: string): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidInputError(`${field} must be a finite number`, {
        field,
      });
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError(`${field} must be an integer`, { field });
    }
    if (value <= 0) {
      throw new InvalidInputError(`${field} must be strictly positive`, {
        field,
      });
    }
  }
}
