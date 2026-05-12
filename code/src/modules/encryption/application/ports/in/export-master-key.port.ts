import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";
import type { PrintableMasterKey } from "../../../domain/value-objects/printable-master-key.ts";

/**
 * Input contract for {@link ExportMasterKey}.
 *
 * - `workspaceId`        — identifies the encrypted workspace whose
 *   master key will be rendered. The aggregate is loaded by this id;
 *   the use case refuses to operate on workspaces whose encryption
 *   config does not exist (`shared` / `private` modes).
 * - `currentPassphrase`  — passphrase that opens ANY currently active
 *   envelope. The use case delegates unlock to {@link UnlockEncryption}
 *   internally so the in-memory aggregate becomes unlocked BEFORE the
 *   bytes are rendered. A wrong value surfaces as a
 *   `KeyValidationFailedError` and the master key is NEVER touched on
 *   stdout.
 */
export interface ExportMasterKeyInput {
  readonly workspaceId: WorkspaceId;
  readonly currentPassphrase: Passphrase;
}

/**
 * Output contract for {@link ExportMasterKey}.
 *
 * - `printableMasterKey` — the canonical Bech32 BIP-173 VO wrapping
 *   the SAME 32 bytes the aggregate currently holds. The caller is
 *   expected to render it via `toRenderedWithGrouping()` on stdout
 *   ONCE and discard the reference; the VO redacts itself in JSON
 *   serialisation so accidental logger calls do not leak.
 * - `exportedAt`         — canonical timestamp the use case stamped
 *   on the `ExportKeyEmitted` audit row. Re-emitted on the wire so
 *   the CLI can display "Generada en YYYY-MM-DDTHH:MM:SSZ" as a
 *   forensic anchor for operators reconciling stdout output with
 *   the audit log.
 */
export interface ExportMasterKeyOutput {
  readonly printableMasterKey: PrintableMasterKey;
  readonly exportedAt: Timestamp;
}

/**
 * Driving (input) port: re-render the master key of an already-
 * existing encrypted workspace as a Bech32 BIP-173 string suitable
 * for one-shot stdout display.
 *
 * **Source-of-truth: ADR-005 Q3 (Phase-22, `docs/12-lineamientos-arquitectura.md`
 * §1.5.5 appendix Q3) + `docs/11-seguridad-modos.md` §3.** Q3
 * ratifies Bech32 BIP-173 (HRP `m3`, 61 chars total, BCH checksum)
 * as the chosen encoding for the recovery master key, with cosmetic
 * dash grouping every 4 chars on rendering. The output stream is
 * stdout-only — NEVER through the MCP channel — and the use case
 * emits a single `ExportKeyEmitted` audit row per invocation so
 * operators have a forensic trail of every export.
 *
 * Flow (7 steps, mirrors A5 / A6 but read-only):
 * 1. Delegate to {@link UnlockEncryption} so the aggregate becomes
 *    unlocked in memory. Refuse if absent
 *    (`EncryptionNotInitializedError`) or the passphrase does not
 *    match any envelope (`KeyValidationFailedError`).
 * 2. Defence-in-depth: re-check `config.isUnlocked()` and throw
 *    `EncryptionLockedError` if the unlock contract was somehow
 *    violated (the contract guarantees it isn't, but failing loud
 *    avoids a silent invariant breach downstream).
 * 3. Render the master key into a fresh `PrintableMasterKey` VO via
 *    `config.withUnlockedKey((masterKey) => masterKey.withBytes(bytes =>
 *    PrintableMasterKey.fromMasterKey(bytes)))`. The VO defensively
 *    copies the bytes; the in-aggregate buffer is never aliased.
 * 4. Compute the master-key fingerprint for the audit row via
 *    `MasterKeyFingerprint.fromMasterKey(bytes)`. The fingerprint VO
 *    never surfaces outside the audit adapter (see the
 *    `MasterKeyFingerprint` security invariants).
 * 5. Snapshot the canonical `Timestamp` from the clock; reused on
 *    the audit row and re-emitted on the wire output as
 *    `exportedAt` so the CLI's stdout footer matches the SQL row
 *    by construction.
 * 6. Emit a single `ExportKeyEmitted` audit row inside one
 *    `DatabaseConnection.transaction(...)` so the row is atomically
 *    committed or aborted. NO filesystem persistence happens here —
 *    export is read-only over the aggregate; `config.json` is NOT
 *    re-saved.
 * 7. Return `{ printableMasterKey, exportedAt }` to the caller. The
 *    consumer is the CLI facade, which projects the VO onto its
 *    rendered (dash-grouped) string form before writing to stdout.
 *
 * Atomicity (ADR-005 Q3, simpler than A5 / A6):
 * - **Single audit row, no filesystem write.** A crash between
 *   computing the fingerprint and inserting the row leaves both the
 *   master key (still on disk inside its envelope) and the audit
 *   log (silent on the export) in a consistent state. There is no
 *   FS-vs-SQL gap to reason about because the export never mutates
 *   the aggregate; the in-memory `PrintableMasterKey` VO is
 *   discarded if the audit insert fails.
 * - The audit append happens inside `database.transaction(...)` so
 *   a partial commit cannot leave half a row visible to readers.
 * - Residual risk: if the SQL transaction commits but the process
 *   crashes BEFORE the rendered string reaches stdout, the user
 *   sees no recovery key but the audit log records the export.
 *   The operator can detect the gap (audit row with no operator
 *   recollection) and re-run; the row is informational only.
 *
 * Failure modes (THROWN — no Result channel):
 * - `EncryptionNotInitializedError` — workspace has no encryption
 *   config (mode `shared` / `private`).
 * - `KeyValidationFailedError`     — `currentPassphrase` did not
 *   match any envelope.
 * - `EncryptionLockedError`        — defensive; should never trigger
 *   because step 1 unlocks the aggregate.
 * - `InvalidInputError`            — structural failure in
 *   `PrintableMasterKey.fromMasterKey(...)`; effectively unreachable
 *   because the aggregate guarantees a 32-byte master.
 * - `InfrastructureError` subclasses — propagated unchanged (e.g. a
 *   SQLite I/O failure during the audit append).
 *
 * Non-mutating contract (NON-NEGOTIABLE):
 * - The use case is read-only over the aggregate. It does NOT call
 *   `addEnvelope`, `removeEnvelope`, `lock`, or `repository.save`.
 *   The aggregate stays untouched on disk; only the audit log
 *   records the export. This is the architectural reason the use
 *   case constructor takes a smaller dependency surface than A5 /
 *   A6 (no KDF, no cipher, no random bytes, no config repository).
 */
export interface ExportMasterKey {
  exportMasterKey(input: ExportMasterKeyInput): Promise<ExportMasterKeyOutput>;
}
