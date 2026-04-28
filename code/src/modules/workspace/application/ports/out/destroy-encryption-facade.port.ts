import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driven (output) facade port toward the `encryption` module's
 * destroy / decrypt path used by mode transitions out of `encrypted`
 * (`docs/11-seguridad-modos.md` §5).
 *
 * The contract is intentionally narrow: the facade tears down the
 * encryption slice (envelopes, validator blob, persisted KdfSpec)
 * after re-keying / decrypting the underlying SQLite databases. The
 * workspace module does not orchestrate the SQLCipher details; it
 * only signals "we are leaving encrypted mode for `<targetMode>`".
 *
 * Pre-condition: the workspace MUST be unlocked. The workspace use
 * case verifies that via the aggregate's `assertReadyForUse` before
 * invoking this facade. The encryption module re-checks at its own
 * boundary as a defence in depth.
 *
 * Authority:
 *   - The `passphrase` field carries the user-supplied secret that the
 *     encryption module uses to re-derive a key and re-validate
 *     ownership before destroying anything. The workspace's own state
 *     (the in-memory "is unlocked?" flag) is NOT a sufficient proof: a
 *     stale unlock could let any process call this facade. The
 *     passphrase MUST match a current envelope.
 *   - The CLI flow is the canonical source of the passphrase: the
 *     `mode change` command prompts the user when the transition leaves
 *     `encrypted`. The composition root forwards that string straight
 *     into the use case input, into this facade input, and finally into
 *     `Passphrase.from(...)` inside the encryption-module adapter.
 *
 * Failure modes:
 *   - Operational failures (KDF, AEAD, I/O) propagate as
 *     `InfrastructureError`. The workspace use case logs and aborts
 *     the transition; the aggregate is left in `encrypted` mode.
 *   - A wrong passphrase surfaces as a typed error from the encryption
 *     module (`KeyValidationFailedError`); the workspace use case
 *     forwards it unchanged to the CLI handler.
 */
export type DestroyEncryptionTargetMode = "shared" | "private";

export interface DestroyEncryptionFacade {
  destroy(input: {
    readonly workspaceId: WorkspaceId;
    readonly targetMode: DestroyEncryptionTargetMode;
    /**
     * Plain passphrase string captured from the CLI prompt. The adapter
     * wraps it in `Passphrase.from(...)` at the encryption boundary;
     * the workspace module itself NEVER imports `Passphrase` (per
     * `docs/12 §1.5`).
     */
    readonly passphrase: string;
  }): Promise<void>;
}
