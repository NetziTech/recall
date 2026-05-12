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

/**
 * Input contract for {@link RekeyFacade}.
 *
 * ADR-005 Q2 (Phase-22, `docs/12-lineamientos-arquitectura.md` §1.5.5
 * appendix): rekey rotates the envelope list under the
 * `addEnvelope(new) → verify → removeEnvelope(old)` pattern. The
 * master key is NOT rotated, which is why the facade requires:
 *
 *   - `currentPassphrase` — opens any currently active envelope so
 *     the in-memory aggregate can be unlocked BEFORE the rotation
 *     begins. A wrong value surfaces as a `KeyValidationFailedError`
 *     and the envelope list stays untouched.
 *   - `newPassphrase`     — passphrase the workspace will be opened
 *     with from now on. A fresh `KeyEnvelope` wraps the SAME master
 *     key under this passphrase.
 *   - `label`             — optional human-readable identifier for
 *     the freshly minted envelope (used by `recall add-key --list`).
 *
 * The wire shape carries plain strings; the facade converts them
 * into `Passphrase` / `KeyLabel` value objects at the boundary.
 */
export interface RekeyFacadeInput {
  readonly rootPath: string;
  readonly currentPassphrase: string;
  readonly newPassphrase: string;
  readonly label: string | null;
}

/**
 * Output contract for {@link RekeyFacade}.
 *
 *   - `workspaceId`         — canonical id of the workspace the
 *     facade operated on (resolved by `DetectWorkspace`).
 *   - `newKeyId`            — id of the freshly minted envelope.
 *     Identical to the value the CLI handler prints under the
 *     "rotation completada" banner.
 *   - `removedKeyIds`       — ids of every envelope that existed
 *     before the rotation and was stripped during the flow.
 *     Sorted ascending by the original `createdAt` so consumers
 *     can rely on a stable order across runs.
 *   - `rotatedAt`           — ISO-8601 timestamp the use case
 *     stamped on the new envelope (re-used by the audit-log rows).
 */
export interface RekeyFacadeOutput {
  readonly workspaceId: string;
  readonly newKeyId: string;
  readonly removedKeyIds: readonly string[];
  readonly rotatedAt: string;
}

export interface RekeyFacade {
  rekey(input: RekeyFacadeInput): Promise<RekeyFacadeOutput>;
}

export interface AddKeyFacadeInput {
  readonly rootPath: string;
  /**
   * Passphrase the workspace is CURRENTLY encrypted under. The facade
   * runs unlock(current) BEFORE the multi-key add, so a wrong value
   * surfaces as a `KeyValidationFailedError` (wire `-32108
   * INVALID_KEY`) without touching the envelope list. ADR-005 Q1
   * pins this requirement on the input shape (Phase-22 appendix in
   * `docs/12-lineamientos-arquitectura.md` §1.5.5).
   */
  readonly currentPassphrase: string;
  readonly newPassphrase: string;
  readonly label: string | null;
}

export interface AddKeyFacadeOutput {
  readonly workspaceId: string;
  readonly keyId: string;
  /**
   * Identifier of the freshly minted envelope, formatted for direct
   * CLI rendering. NOT a re-emission of the master key — add-key
   * registers a new passphrase that wraps the SAME master key, so no
   * new printable master is produced. The field name is preserved
   * across {@link ExportKeyFacadeOutput}, {@link RekeyFacadeOutput}
   * and this output so the CLI handler can reuse the existing
   * banner spacing without a special case for add-key; the renderer
   * decides whether to format the value as a key box or as a
   * one-line id.
   */
  readonly printableKey: string;
}

export interface AddKeyFacade {
  add(input: AddKeyFacadeInput): Promise<AddKeyFacadeOutput>;
}
