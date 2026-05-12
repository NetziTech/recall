/**
 * Barrel for the CLI module's interactive prompt helpers.
 *
 * Per ADR-005 Q5 (`docs/12-lineamientos-arquitectura.md` §1.5.5) these
 * primitives live inside the `cli` module's infrastructure layer
 * because they are only consumed by `cli` commands (`init`,
 * `add-key`, `rekey`, `export-key`). They do NOT belong in
 * `shared/infrastructure/` per the §1.5 R3 rule of "shared only if
 * 2+ modules depend on it".
 *
 * The error subclasses are part of the existing
 * {@link CliInfrastructureError} hierarchy — there is no new error
 * class; the three new failure dimensions are tagged via the union
 * code (`cli.no-tty-for-passphrase`, `cli.passphrase-mismatch`,
 * `cli.weak-passphrase`). Callers route on `error.code`.
 */
export { assertTty, readPassphrase } from "./passphrase-prompt.ts";
export {
  confirmPassphrase,
  constantTimeEqualPadded,
} from "./confirm-prompt.ts";
export { assertStrongPassphrase, shannonBits } from "./strength-meter.ts";
