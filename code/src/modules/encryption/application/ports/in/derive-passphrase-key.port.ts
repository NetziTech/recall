import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { WeakKdfParamsError } from "../../../domain/errors/weak-kdf-params-error.ts";
import type { DerivedKey } from "../../../domain/value-objects/derived-key.ts";
import type { KdfParams } from "../../../domain/value-objects/kdf-params.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Driving (input) port: derive a `DerivedKey` from a `Passphrase` +
 * `KdfParams`.
 *
 * Why an input port (instead of letting callers depend on the use
 * case class directly):
 * - The MCP server, the CLI and the workspace bootstrap all need to
 *   derive keys but in different control flows (interactive prompt,
 *   CLI flag, automatic on `mem.init`). The input port lets each
 *   caller depend on a stable contract while the use case orchestrates
 *   the underlying `Kdf` driven port.
 * - The contract carries the same Result channel as `Kdf.derive` for
 *   the only domain-level error (weak params); primitive-level
 *   failures throw via `InfrastructureError` and propagate to the
 *   composition root.
 */
export interface DerivePassphraseKey {
  derive(input: {
    passphrase: Passphrase;
    params: KdfParams;
  }): Promise<Result<DerivedKey, WeakKdfParamsError>>;
}
