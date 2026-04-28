import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Result of an `ImportHandoff.import(...)` invocation.
 */
export interface ImportHandoffResult {
  readonly workspaceId: WorkspaceId;
  readonly importedAtMs: number;
  readonly counts: Readonly<{
    decisions: number;
    learnings: number;
    tasks: number;
  }>;
  /**
   * Sections / lines the parser saw but could not classify. Surfaced
   * to the operator so they can fill in the gaps manually after the
   * import.
   */
  readonly skipped: readonly string[];
}

/**
 * Driving (input) port: turn an existing `HANDOFF.md` into the seed
 * memory of a fresh workspace.
 *
 * Maps to the CLI's `mcp-memoria import-handoff <path>`
 * (`docs/07-instalacion.md` §7.11) and is one of the headline value
 * propositions of the project: the very document that the MCP
 * replaces is the bootstrap for the new workspace.
 *
 * Heuristics (mirrors how a typical HANDOFF is written):
 *
 * 1. Sections under `## 2. Decisiones tomadas` (and variants) become
 *    `Decision` rows. Each table row or bullet is a candidate; the
 *    parser extracts a title (first sentence) and a rationale (the
 *    rest). Confidence is set to 0.9 (slightly less than full so the
 *    curator can decay them naturally).
 * 2. Sections under `## 6. Workflow` / `## 6.X` whose body matches the
 *    "Decision" / "Learning" pattern are routed to the right kind.
 * 3. "Pendientes" / "Tareas" sections become `Task` rows in `todo`
 *    status with priority `medium`.
 * 4. Free-text observations ("Bug numérico en ...") become
 *    `Learning` rows with severity `warning`.
 *
 * The parser is intentionally LENIENT: when in doubt, a section is
 * skipped (and reported in `skipped`) rather than miscategorised. The
 * import is idempotent only if the `HANDOFF.md` is byte-stable; a
 * second pass over a re-edited document inserts duplicates that the
 * curator's consolidation pass folds.
 */
export interface ImportHandoff {
  import(input: {
    workspaceId: WorkspaceId;
    /** Raw UTF-8 content of the HANDOFF.md document. */
    markdown: string;
  }): Promise<ImportHandoffResult>;
}
