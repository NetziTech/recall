import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of supported key-derivation algorithms.
 *
 * The MVP catalog is intentionally narrow: only `argon2id` is allowed,
 * matching the contract documented in `docs/11-seguridad-modos.md` §3
 * (`kdf: "argon2id"` in `config.json`) and §7 (the validation flow uses
 * argon2id with caller-supplied params). Restricting the set at the
 * type level (a) prevents accidental downgrade attacks via stale
 * configs and (b) makes any future algorithm rotation an explicit,
 * reviewed code change rather than a silent string substitution.
 *
 * The array below is the single source of truth: the
 * `KdfAlgorithmKind` union is derived from its element type, so adding
 * a new algorithm is a one-line change here and the union updates
 * automatically. Mirrors the pattern used in
 * `WorkspaceMode`/`JsonRpcErrorCodes`.
 */
const KDF_ALGORITHM_KINDS = ["argon2id"] as const;

/**
 * Discriminated union of the legal KDF algorithm names. Currently only
 * `argon2id` is allowed; future variants (e.g. `argon2id-v2`) require
 * a deliberate addition to `KDF_ALGORITHM_KINDS` and the corresponding
 * adapter implementations.
 */
export type KdfAlgorithmKind = (typeof KDF_ALGORITHM_KINDS)[number];

/**
 * Value object representing a key-derivation algorithm name.
 *
 * Mirrors the `kdf` field of the encrypted-mode config documented in
 * `docs/03-modelo-datos.md` §2 ("Campos especificos del modo
 * encrypted") and `docs/11-seguridad-modos.md` §3 / §7. The actual
 * cryptographic computation lives in the infrastructure adapter
 * (Argon2idKDF, see `docs/12-lineamientos-arquitectura.md` §2); this
 * value object is purely the *name* of the algorithm so the domain can
 * reason about which spec is in use without depending on a concrete
 * implementation.
 *
 * Invariants:
 * - The wrapped `kind` is always one of `KDF_ALGORITHM_KINDS`. Any
 *   other string is rejected at the factory boundary.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `KdfAlgorithm` instances are equal iff they share the same
 *   `kind`.
 */
export class KdfAlgorithm {
  private constructor(public readonly kind: KdfAlgorithmKind) {}

  /**
   * Builds a `KdfAlgorithm` from an arbitrary string. Used when reading
   * `config.json`. Whitespace is tolerated (trimmed) but case is
   * significant: the canonical form is lowercase to match the storage
   * format.
   */
  public static create(raw: string): KdfAlgorithm {
    if (typeof raw !== "string") {
      throw new InvalidInputError("kdf algorithm must be a string", {
        field: "kdf",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("kdf algorithm must not be empty", {
        field: "kdf",
      });
    }
    if (!KdfAlgorithm.isKind(trimmed)) {
      throw new InvalidInputError(
        `kdf algorithm must be one of "argon2id" (got: "${raw}")`,
        { field: "kdf" },
      );
    }
    return new KdfAlgorithm(trimmed);
  }

  /**
   * Convenience factory for the canonical `argon2id` algorithm.
   */
  public static argon2id(): KdfAlgorithm {
    return new KdfAlgorithm("argon2id");
  }

  /**
   * Type guard used internally and exposed for callers that need to
   * validate raw strings without instantiating the VO.
   */
  public static isKind(candidate: string): candidate is KdfAlgorithmKind {
    for (const known of KDF_ALGORITHM_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isArgon2id(): boolean {
    // Tautological today (the union has a single member) but kept as a
    // forward-compatible predicate: when `KDF_ALGORITHM_KINDS` grows
    // (e.g. `argon2id-v2`) callers should not have to learn a new API.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return this.kind === "argon2id";
  }

  public toString(): KdfAlgorithmKind {
    return this.kind;
  }

  public equals(other: KdfAlgorithm): boolean {
    // Today both `kind`s can only be `"argon2id"`, but the equality
    // contract is part of every VO and must remain a real comparison
    // for when the union grows.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return this.kind === other.kind;
  }
}
