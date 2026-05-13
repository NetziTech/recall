import type { Timestamp } from "../../domain/value-objects/timestamp.ts";

/**
 * Driven (output) port that surfaces small read-only projections of
 * `encryption_audit_log` to consumers outside the encryption module.
 *
 * **Why a dedicated port and not `EncryptionAuditLogRepository`:**
 * - The repository port in `modules/encryption/domain/repositories/`
 *   is intentionally write-only at the domain boundary: it exposes
 *   only `append(event)`. Adding read methods there would force every
 *   future implementer to provide them, and worse, the read methods
 *   would have privileged access to `masterKeyFingerprint` values
 *   which the contract forbids surfacing.
 * - This port is the boundary used by the workspace `HealthCheck`
 *   use case (cross-module via `shared/`, see ADR-001 in
 *   `docs/12-lineamientos-arquitectura.md` §1.5). Living here means
 *   neither the workspace module imports from encryption, nor
 *   encryption from workspace; the composition root wires the
 *   adapter once.
 *
 * Contract:
 * - Implementations MUST NOT return `master_key_fp` values from any
 *   method on this port. Even projected fields stay redacted-by-default.
 * - Implementations MAY assume the `encryption_audit_log` table exists
 *   (migration 009 runs unconditionally) and is append-only.
 * - Methods MUST be safe to call on every workspace mode. For
 *   `shared` / `private` workspaces the table is naturally empty, so
 *   every method returns `null` / `0` / equivalent. Callers do NOT
 *   need to gate on workspace mode before calling.
 *
 * Closes follow-up tracked FU-A7-2 (HANDOFF §8): the CLI's
 * `recall health` surfaces `last_export_at` so the user can detect
 * an export that did not originate from them (defense in depth
 * against unauthorised terminal access).
 */
export interface EncryptionAuditProbe {
  /**
   * Returns the timestamp of the most recent successful
   * `ExportKeyEmitted` audit row for this workspace, or `null` if no
   * `recall export-key` invocation has ever succeeded.
   *
   * The probe ignores `FAILURE` outcomes — those are captured by
   * `UnlockFailed` rows with `actorHint=cli:export-key` instead.
   */
  lastExportAt(): Promise<Timestamp | null>;
}
