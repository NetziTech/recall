import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driven (output) facade port toward the `encryption` module's
 * `InitializeEncryption` use case.
 *
 * Why a facade and not a direct import of the encryption module:
 *   - `docs/12-lineamientos-arquitectura.md` §1.5 forbids workspace
 *     from importing types declared in `modules/encryption/`. The
 *     composition root wires this facade to the real
 *     `InitializeEncryptionUseCase`, translating the workspace-side
 *     primitives (raw passphrase string, workspace id) into the
 *     encryption module's domain VOs (`Passphrase`, `WorkspaceId` —
 *     re-imported from `shared/`).
 *
 * Contract:
 *   - The facade is invoked exclusively by the
 *     `InitializeWorkspaceUseCase` when `mode === "encrypted"`. It
 *     mints the master key + first envelope and persists the
 *     encryption slice of `config.json`. The bytes of the master key
 *     are wiped before the call returns; the facade returns nothing
 *     observable to the workspace module.
 *   - Failures propagate as either `InfrastructureError` (KDF /
 *     CSPRNG / I/O failures) or domain errors from the encryption
 *     module (rare on init). The workspace use case lets them bubble
 *     unchanged.
 */
export interface InitializeEncryptionFacade {
  initialize(input: {
    readonly workspaceId: WorkspaceId;
    /**
     * Raw passphrase typed by the operator. The facade adapter is
     * responsible for wrapping it in the encryption module's
     * `Passphrase` VO at the boundary; this port stays free of
     * encryption-domain types per modularity.
     */
    readonly passphrase: string;
  }): Promise<void>;
}
