import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { SanitizedText } from "../../../domain/value-objects/sanitized-text.ts";

/**
 * Driving (input) port: scan free-form text for secrets and return the
 * sanitised view.
 *
 * Implements the "Capa 1 — Pre-write detection" flow documented in
 * `docs/11-seguridad-modos.md` §6. The use case orchestrates the
 * domain `SecretsScanner` (regex registry + entropy detector) and
 * returns the resulting `SanitizedText` so callers can:
 *
 * - Consume the `findings` array to decide whether to block (`hard
 *   reject`) or warn the user (`high_entropy_blob`).
 * - Use `sanitized` as the value to persist when the action is
 *   `redacted`.
 *
 * The use case does NOT decide what to do with the findings — it is
 * a query, not a command. The downstream `record_*` use cases (in
 * the memory module) inspect the findings and pick the action.
 */
export interface ScanText {
  scan(input: {
    text: string;
    workspaceId: WorkspaceId;
  }): Promise<SanitizedText>;
}
