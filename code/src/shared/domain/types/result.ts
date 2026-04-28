/**
 * Result type for operations that can fail without throwing.
 *
 * Use `Result<T, E>` whenever an operation has an expected, recoverable
 * failure mode that the caller must handle explicitly. Throwing is
 * reserved for invariant violations and unrecoverable errors.
 *
 * Invariants:
 * - A `Result` is either an `Ok<T>` (success, with `value`) or an
 *   `Err<E>` (failure, with `error`). The discriminant `kind` is
 *   exhaustive.
 * - Both variants are immutable (`readonly`).
 * - `isOk` and `isErr` are type guards that narrow the union.
 */

export interface Ok<T> {
  readonly kind: "ok";
  readonly value: T;
}

export interface Err<E> {
  readonly kind: "err";
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Constructs a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return { kind: "ok", value };
}

/**
 * Constructs a failed result.
 */
export function err<E>(error: E): Err<E> {
  return { kind: "err", error };
}

/**
 * Type guard: narrows to `Ok<T>`.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.kind === "ok";
}

/**
 * Type guard: narrows to `Err<E>`.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.kind === "err";
}
