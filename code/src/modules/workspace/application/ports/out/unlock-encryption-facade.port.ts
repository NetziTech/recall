import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driven (output) facade port toward the `encryption` module's
 * `UnlockEncryption` use case.
 *
 * Outcome contract:
 *   - `unlocked: true` when the candidate passphrase derived a master
 *     key that correctly opened the validator blob. The encryption
 *     adapter has cached the resulting key under
 *     `~/.config/recall/keys/<workspace_id>.key` (per
 *     `docs/11-seguridad-modos.md` §3) so subsequent server starts
 *     can transparently re-open the database.
 *   - `unlocked: false` with `reason: "key-validation-failed"` when
 *     the supplied passphrase is wrong (mapped to JSON-RPC `-32108`
 *     INVALID_KEY at the protocol boundary). The CLI surfaces the
 *     `invalidKey` exit code.
 *   - `unlocked: false` with `reason: "not-encrypted"` when the
 *     workspace is not in encrypted mode. The workspace use case
 *     turns this into a no-op success (`UnlockWorkspaceOutput.wasUnlocked
 *     = false`).
 *
 * Why an enum-discriminated outcome and not exceptions:
 *   - Wrong-key is the EXPECTED failure on this path; using
 *     exceptions for it conflates expected business outcomes with
 *     unrecoverable infrastructure failures (e.g. the KDF binding
 *     not loading). The latter still propagate as exceptions.
 */
export type UnlockEncryptionFacadeOutcome =
  | { readonly unlocked: true }
  | {
      readonly unlocked: false;
      readonly reason: "key-validation-failed" | "not-encrypted";
    };

export interface UnlockEncryptionFacade {
  unlock(input: {
    readonly workspaceId: WorkspaceId;
    /**
     * `null` instructs the facade to attempt to read the cached
     * passphrase / key from `~/.config/recall/keys/...`. A
     * non-null value is the operator-typed passphrase from
     * `recall unlock --workspace`.
     */
    readonly passphrase: string | null;
  }): Promise<UnlockEncryptionFacadeOutcome>;
}
