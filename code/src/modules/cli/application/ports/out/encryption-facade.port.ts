/**
 * Driven (output) facade ports toward the encryption module's
 * key-lifecycle use cases that the CLI invokes:
 *
 *   - `recall export-key` — re-print the key in the box layout
 *     described in `docs/11-seguridad-modos.md` §3 ("Que ocurre al
 *     inicializar"). Pre-condition: the workspace must be unlocked.
 *   - `recall rekey`      — generate a new master key, re-cipher
 *     every envelope, print the new key once. Pre-condition: unlocked.
 *   - `recall add-key`    — append a secondary envelope (multi-key,
 *     v0.5+). Returns the freshly minted key id.
 *
 * The CLI passes raw passphrases / labels and receives back the
 * sensitive material as a one-shot string in the success outcome
 * (the `printableKey` field) so the entrypoint adapter can render it
 * once and discard the reference.
 */

export interface ExportKeyFacadeInput {
  readonly rootPath: string;
}

export interface ExportKeyFacadeOutput {
  readonly workspaceId: string;
  /** Human-grouped key (`M3-ZK7L-...`) ready for one-shot printing. */
  readonly printableKey: string;
}

export interface ExportKeyFacade {
  export(input: ExportKeyFacadeInput): Promise<ExportKeyFacadeOutput>;
}

export interface RekeyFacadeInput {
  readonly rootPath: string;
  readonly newPassphrase: string;
}

export interface RekeyFacadeOutput {
  readonly workspaceId: string;
  readonly printableKey: string;
}

export interface RekeyFacade {
  rekey(input: RekeyFacadeInput): Promise<RekeyFacadeOutput>;
}

export interface AddKeyFacadeInput {
  readonly rootPath: string;
  readonly newPassphrase: string;
  readonly label: string | null;
}

export interface AddKeyFacadeOutput {
  readonly workspaceId: string;
  readonly keyId: string;
  readonly printableKey: string;
}

export interface AddKeyFacade {
  add(input: AddKeyFacadeInput): Promise<AddKeyFacadeOutput>;
}
