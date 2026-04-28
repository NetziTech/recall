/**
 * Branded type utility.
 *
 * Provides nominal typing on top of structural primitives so distinct
 * domain identifiers (e.g. `WorkspaceId`, `DecisionId`) remain
 * non-interchangeable even though they share the same underlying
 * representation (`string`).
 *
 * Invariants:
 * - The brand marker `__brand` is `readonly` and exists only at the type
 *   level (it is never present at runtime). It is therefore impossible to
 *   construct a branded value by mistake; the only way to obtain one is
 *   through a value object factory that performs validation.
 *
 * Example:
 *   type WorkspaceIdValue = Brand<string, "WorkspaceId">;
 *   const raw = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89" as WorkspaceIdValue;
 */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};
