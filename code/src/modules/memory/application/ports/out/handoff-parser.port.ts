import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";

/**
 * One decision extracted from a `HANDOFF.md` document.
 */
export interface ParsedHandoffDecision {
  readonly title: string;
  readonly rationale: string;
  readonly tags: Tags;
  /** Confidence in [0, 1]; the parser is heuristic so values < 1 are normal. */
  readonly confidence: number;
}

/**
 * One learning extracted from a `HANDOFF.md` document.
 */
export interface ParsedHandoffLearning {
  readonly text: string;
  readonly severity: "tip" | "warning" | "critical";
  readonly tags: Tags;
}

/**
 * One pending task extracted from a `HANDOFF.md` document.
 */
export interface ParsedHandoffTask {
  readonly title: string;
  readonly description: string | null;
  readonly priority: "low" | "medium" | "high" | "critical";
  readonly tags: Tags;
}

/**
 * Result of a `HandoffParser.parse(...)` call.
 *
 * The parser is intentionally lenient: lines / sections it cannot
 * classify are reported in `skipped` so the operator can fill in the
 * gaps manually. The application layer translates the result into
 * `Decision` / `Learning` / `Task` aggregates.
 */
export interface ParsedHandoff {
  readonly decisions: readonly ParsedHandoffDecision[];
  readonly learnings: readonly ParsedHandoffLearning[];
  readonly tasks: readonly ParsedHandoffTask[];
  readonly skipped: readonly string[];
}

/**
 * Driven (output) port: parse a `HANDOFF.md` markdown document into
 * a typed bag of decisions / learnings / tasks.
 *
 * The implementation lives in `infrastructure/import-export/` and is
 * heuristic-based (regex over section headers + bullet patterns).
 * Failures surface as
 * `MemoryInfrastructureError.handoffParseFailed(...)`.
 */
export interface HandoffParser {
  parse(markdown: string): ParsedHandoff;
}
