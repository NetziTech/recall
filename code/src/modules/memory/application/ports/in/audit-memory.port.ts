import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * One issue surfaced by the audit pass.
 *
 * `severity` mirrors the `mem.health` finding levels documented in
 * `docs/02-protocolo-mcp.md` §4.6 ("info | warn | error"). `code` is a
 * stable kebab-case identifier so the CLI's renderer can colour-code
 * the table; renaming is a breaking change.
 */
export interface AuditIssue {
  readonly severity: "info" | "warn" | "error";
  readonly code: string;
  readonly message: string;
  /** Optional pointer to the offending memory entry. */
  readonly entryRef: { readonly kind: string; readonly id: string } | null;
}

/**
 * Result of an `AuditMemory.audit(...)` invocation.
 */
export interface AuditMemoryResult {
  readonly workspaceId: WorkspaceId;
  readonly checkedAtMs: number;
  readonly issues: readonly AuditIssue[];
  /**
   * Per-kind counters so the CLI can surface "5,234 turns / 312
   * decisions / ..." even when no issues are found.
   */
  readonly counts: Readonly<{
    decisions: number;
    learnings: number;
    entities: number;
    tasks: number;
    turns: number;
    sessions: number;
    relations: number;
  }>;
}

/**
 * Driving (input) port: run the consistency-audit pass over the
 * workspace's memory.
 *
 * Maps to the CLI's `recall audit` (`docs/07-instalacion.md`
 * §7.10). Checks performed:
 *
 * 1. Orphaned `superseded_by` (decision points at non-existent id).
 * 2. Orphaned `consolidated_into` (learning points at non-existent
 *    id).
 * 3. `relations` whose endpoints no longer exist.
 * 4. `turns.session_id` referencing a missing session.
 * 5. `tasks.blocked_by_json` referencing missing task ids.
 * 6. Empty / sentinel `last_used_ms` columns (defensive — the
 *    persistence adapter always stamps a non-null value).
 *
 * The use case is read-only: it never mutates and never throws on
 * findings. A workspace with corrupted state surfaces issues; the
 * caller decides how to react (the CLI prints; the curator's
 * `SelfHealUseCase` may consume the issues to schedule fixes).
 */
export interface AuditMemory {
  audit(input: { workspaceId: WorkspaceId }): Promise<AuditMemoryResult>;
}
