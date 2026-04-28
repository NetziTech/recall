import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { KdfAlgorithm } from "./kdf-algorithm.ts";
import { KdfParams } from "./kdf-params.ts";
import type { SaltBytes } from "./salt-bytes.ts";

/**
 * Composite value object that groups the algorithm name and its
 * parameters into the canonical "kdf spec" used by the rest of the
 * encryption module.
 *
 * Mirrors how `config.json` lays out the encrypted-mode fields
 * documented in `docs/03-modelo-datos.md` §2:
 *
 * ```json
 * {
 *   "kdf": "argon2id",
 *   "kdf_params": { "memory_kib": 65536, "iterations": 3, "parallelism": 4, "salt_b64": "..." }
 * }
 * ```
 *
 * The two halves cannot be reasoned about independently: the
 * parameter shape (`memory_kib`, `iterations`, `parallelism`,
 * `salt`) only makes sense in the context of a specific algorithm.
 * Bundling them in a VO keeps the `EncryptionConfig` aggregate's
 * surface tidy and gives serialization adapters a single object to
 * project onto JSON instead of two parallel fields.
 *
 * Invariants:
 * - `algorithm.equals(params.algorithm)` — the embedded algorithm
 *   must match the standalone field. The factory enforces this so
 *   downstream code can read either side and obtain the same answer.
 *
 * Equality:
 * - Two `KdfSpec` instances are equal iff both `algorithm` and
 *   `params` are equal (delegates to each VO's `equals`).
 */
export class KdfSpec {
  private constructor(
    public readonly algorithm: KdfAlgorithm,
    public readonly params: KdfParams,
  ) {}

  /**
   * Builds a `KdfSpec` from its two halves. The application layer
   * is responsible for parsing the JSON into VOs before delegating
   * here.
   */
  public static create(input: {
    algorithm: KdfAlgorithm;
    params: KdfParams;
  }): KdfSpec {
    if (!input.algorithm.equals(input.params.algorithm)) {
      // The two algorithm references must agree. If they don't, the
      // caller has assembled inconsistent state. Modelled as an
      // invariant violation (not `InvalidInputError`) because the
      // shape is internally inconsistent rather than externally
      // malformed: nothing in the raw JSON layout could produce this
      // mismatch unless an upstream layer reassembled the parts
      // wrong.
      throw new InvariantViolationError(
        `kdf spec: algorithm "${input.algorithm.toString()}" does not match params.algorithm "${input.params.algorithm.toString()}"`,
        { invariant: "encryption.kdf-spec.algorithm-consistency" },
      );
    }
    return new KdfSpec(input.algorithm, input.params);
  }

  /**
   * Convenience factory that builds the canonical argon2id spec
   * with the recommended parameter floors. The salt MUST be supplied
   * by the caller because it is per-workspace and produced by a
   * CSPRNG in the infrastructure layer.
   */
  public static argon2idDefaults(salt: SaltBytes): KdfSpec {
    const params = KdfParams.defaults(salt);
    return new KdfSpec(params.algorithm, params);
  }

  public equals(other: KdfSpec): boolean {
    if (this === other) return true;
    return (
      this.algorithm.equals(other.algorithm) &&
      this.params.equals(other.params)
    );
  }
}
