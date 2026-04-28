import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Set of `KdfParams` parameters whose minimums are enforced by the
 * domain. The literal union pins the field name so the error
 * message and the validator stay in sync; adding a new parameter
 * (e.g. `lanes`) requires a deliberate code change here.
 */
export type WeakKdfParameterName = "memory_kib" | "iterations" | "parallelism";

/**
 * Raised when a caller attempts to construct a `KdfParams` with
 * parameters weaker than the floors defined by the project policy
 * (`docs/12-lineamientos-arquitectura.md` §5: argon2id with
 * memory >= 64 MiB, iterations >= 3, parallelism >= 4).
 *
 * The error is distinct from `InvalidInputError` because the value
 * IS a valid number (positive integer) — it is just below the
 * security floor. Adapters that map this to a wire-level response
 * typically translate it to `INVALID_PARAMS`, which is why
 * `jsonRpcCode` is `null`: the protocol catalog does not allocate a
 * dedicated code for weak KDF params.
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.weak-kdf-params`.
 * - `parameter` names the offending field (one of
 *   `WEAK_KDF_PARAMETER_NAMES`).
 * - `actual` and `minimum` are echoed for diagnostics; both are
 *   public, non-secret integers.
 */
export class WeakKdfParamsError extends EncryptionDomainError {
  public readonly code = "encryption.weak-kdf-params";
  public readonly jsonRpcCode: number | null = null;
  public readonly parameter: WeakKdfParameterName;
  public readonly actual: number;
  public readonly minimum: number;

  public constructor(input: {
    parameter: WeakKdfParameterName;
    actual: number;
    minimum: number;
    cause?: unknown;
  }) {
    super(
      `kdf parameter "${input.parameter}" is below the project minimum: ${String(input.actual)} < ${String(input.minimum)}`,
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.parameter = input.parameter;
    this.actual = input.actual;
    this.minimum = input.minimum;
  }
}
