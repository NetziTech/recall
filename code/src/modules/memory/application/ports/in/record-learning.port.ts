import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { LearningId } from "../../../domain/value-objects/learning-id.ts";
import type { LearningSeverity } from "../../../domain/value-objects/learning-severity.ts";
import type { Scope } from "../../../domain/value-objects/scope.ts";

/**
 * Result of a `RecordLearning` invocation.
 */
export interface RecordLearningResult {
  readonly learningId: LearningId;
  readonly embeddingEnqueued: boolean;
}

/**
 * Driving (input) port: record a brand-new `Learning` (a short
 * observation captured during a session — "siempre canonicalizar
 * paths antes de comparar").
 *
 * Maps to the `kind=learning` arm of `mem.remember`
 * (`docs/02-protocolo-mcp.md` §4.4). The use case orchestrates:
 *
 * 1. Mints a fresh `LearningId`.
 * 2. Builds the `Learning` aggregate (`Learning.register(...)`).
 * 3. Persists via `LearningRepository.save(...)`.
 * 4. Publishes the buffered events.
 * 5. Enqueues an embedding job (best-effort).
 *
 * Pre-conditions:
 * - The text is non-empty (the VO factory rejects otherwise).
 * - Severity defaults to `tip` when omitted (the use case applies the
 *   default; the spec column default is `'tip'`,
 *   `docs/03-modelo-datos.md` §4.4).
 */
export interface RecordLearning {
  record(input: {
    workspaceId: WorkspaceId;
    text: string;
    severity: LearningSeverity | null;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordLearningResult>;
}
