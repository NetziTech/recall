import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type {
  HandoffParser,
  ParsedHandoff,
  ParsedHandoffDecision,
  ParsedHandoffLearning,
  ParsedHandoffTask,
} from "../../application/ports/out/handoff-parser.port.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

/**
 * Soft cap on the parsed-line buffer. The parser is heuristic; the
 * cap protects against pathologically large markdown documents.
 */
const MAX_LINES = 10_000;

/**
 * Heuristic heading patterns the parser uses to route sections to the
 * right kind. Lowercased before matching; accent-insensitive (the
 * project's own HANDOFF.md uses both accented and unaccented forms).
 */
const DECISION_HEADING_PATTERNS: readonly RegExp[] = Object.freeze([
  /^#+\s+\d+\.?\s*decisiones\b/i,
  /^#+\s+decisiones\s+tomadas/i,
  /^#+\s+architectural\s+decisions/i,
]);

const LEARNING_HEADING_PATTERNS: readonly RegExp[] = Object.freeze([
  /^#+\s+\d+\.?\s*learnings/i,
  /^#+\s+observaciones?\b/i,
  /^#+\s+lessons?\s+learned/i,
]);

const TASK_HEADING_PATTERNS: readonly RegExp[] = Object.freeze([
  /^#+\s+\d+\.?\s*pendientes/i,
  /^#+\s+\d+\.?\s*tareas/i,
  /^#+\s+\d+\.?\s*todo/i,
  /^#+\s+open\s+items/i,
  /^#+\s+bloqueador/i,
]);

/**
 * Hard ceiling on the body of a single bullet/table line. Lines longer
 * than this are truncated before regex matching to keep the parser in
 * the linear regime (defence against ReDoS — see SonarQube S5852).
 *
 * 4096 chars covers the longest legitimate handoff bullets observed in
 * the project's own HANDOFF.md by an order of magnitude.
 */
const MAX_LINE_BODY_CHARS = 4096;

/**
 * Markdown bullet pattern. Matches `- foo`, `* foo`, `+ foo`, and
 * numbered list items `1. foo`.
 *
 * All quantifiers are BOUNDED so the engine cannot enter
 * super-linear backtracking on adversarial input (SonarQube S5852):
 * - `\s{0,16}`     — leading indentation, capped at 16 chars.
 * - `\d{1,9}`      — list-item index, capped at 9 digits (a billion
 *                    list items is far past any realistic markdown).
 * - `\s{1,16}`     — separator after the bullet sigil.
 * - `(.{1,4096})`  — the captured body, hard-capped to
 *                    `MAX_LINE_BODY_CHARS` (lines are pre-trimmed by
 *                    the caller).
 */
const BULLET_PATTERN = /^\s{0,16}(?:[-*+]|\d{1,9}\.)\s{1,16}(.{1,4096})$/;

/**
 * Markdown table-row pattern: `| a | b | c |`. Matches at the very
 * least four pipes, which excludes `| --- | --- |` separator rows.
 *
 * Quantifiers bounded for the same reason as `BULLET_PATTERN`.
 */
const TABLE_ROW_PATTERN = /^\s{0,16}\|(.{1,4096})\|\s{0,16}$/;

/**
 * Heuristic markdown parser for `HANDOFF.md` documents.
 *
 * The parser walks the document line by line, tracking the most
 * recent heading. When a section heading matches one of the
 * `*_HEADING_PATTERNS` lists above, the parser routes subsequent
 * bullet / table rows to the matching kind. Lines that do not look
 * like decisions / learnings / tasks (or that fall outside any
 * recognised section) are dropped into the `skipped` array so the
 * operator can reconcile them manually.
 *
 * Confidence calibration:
 * - Decisions extracted from a HANDOFF.md get `confidence = 0.9`
 *   (slightly less than full so the curator can decay them
 *   naturally; the source is human-authored, not the live system).
 * - Learnings: `severity = "tip"` by default; the heuristic upgrades
 *   to `warning` when the line contains "BUG", "WARN", or
 *   "BLOQUEADOR".
 * - Tasks: `priority = "medium"` by default; the heuristic upgrades
 *   to `high` for "BLOQUEADOR" mentions and `critical` for
 *   "URGENTE".
 *
 * Failures surface as
 * `MemoryInfrastructureError.handoffParseFailed(...)`.
 */
export class MarkdownHandoffParser implements HandoffParser {
  public parse(markdown: string): ParsedHandoff {
    if (typeof markdown !== "string") {
      throw MemoryInfrastructureError.handoffParseFailed(
        "input must be a UTF-8 string",
      );
    }
    const lines = markdown.split(/\r?\n/);
    if (lines.length > MAX_LINES) {
      throw MemoryInfrastructureError.handoffParseFailed(
        `input exceeds ${String(MAX_LINES)} lines (got ${String(lines.length)})`,
      );
    }

    const decisions: ParsedHandoffDecision[] = [];
    const learnings: ParsedHandoffLearning[] = [];
    const tasks: ParsedHandoffTask[] = [];
    const skipped: string[] = [];

    type Section = "decision" | "learning" | "task" | "other";
    let currentSection: Section = "other";

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i] ?? "";
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;

      // Section transitions on `#`-prefixed headings.
      if (trimmed.startsWith("#")) {
        if (MarkdownHandoffParser.matchesAny(trimmed, DECISION_HEADING_PATTERNS)) {
          currentSection = "decision";
        } else if (
          MarkdownHandoffParser.matchesAny(trimmed, LEARNING_HEADING_PATTERNS)
        ) {
          currentSection = "learning";
        } else if (
          MarkdownHandoffParser.matchesAny(trimmed, TASK_HEADING_PATTERNS)
        ) {
          currentSection = "task";
        } else {
          currentSection = "other";
        }
        continue;
      }

      // Pre-truncate the line body to `MAX_LINE_BODY_CHARS + 256`
      // before regex matching. The +256 buffer covers leading
      // indentation and the bullet/pipe sigils so the bounded regex
      // can still capture a body of up to `MAX_LINE_BODY_CHARS`.
      // Lines longer than this are truncated, NOT silently skipped,
      // so the parser still yields a result for huge bullets — the
      // resulting `body` capture is just bounded by the regex itself.
      const truncated =
        raw.length > MAX_LINE_BODY_CHARS + 256
          ? raw.slice(0, MAX_LINE_BODY_CHARS + 256)
          : raw;
      const bulletMatch = BULLET_PATTERN.exec(truncated);
      const tableMatch = TABLE_ROW_PATTERN.exec(truncated);
      const cell =
        bulletMatch !== null
          ? (bulletMatch[1] ?? "").trim()
          : tableMatch !== null
            ? MarkdownHandoffParser.firstCell(tableMatch[1] ?? "")
            : null;
      if (cell === null) {
        // Free text inside a section: collected as "skipped" so the
        // operator can reconcile manually.
        if (currentSection !== "other") {
          skipped.push(`L${String(i + 1)}: ${trimmed}`);
        }
        continue;
      }

      if (cell.length === 0) continue;
      if (cell.startsWith("---")) continue; // table separator

      switch (currentSection) {
        case "decision": {
          const parsed = MarkdownHandoffParser.parseDecisionLine(cell);
          if (parsed === null) {
            skipped.push(`L${String(i + 1)}: ${trimmed}`);
          } else {
            decisions.push(parsed);
          }
          break;
        }
        case "learning": {
          learnings.push(MarkdownHandoffParser.parseLearningLine(cell));
          break;
        }
        case "task": {
          tasks.push(MarkdownHandoffParser.parseTaskLine(cell));
          break;
        }
        case "other": {
          // Outside a recognised section: ignore silently (the
          // skipped array is reserved for things we tried and could
          // not classify).
          break;
        }
      }
    }

    return {
      decisions: Object.freeze(decisions),
      learnings: Object.freeze(learnings),
      tasks: Object.freeze(tasks),
      skipped: Object.freeze(skipped),
    };
  }

  // -- internals --------------------------------------------------------

  private static matchesAny(line: string, patterns: readonly RegExp[]): boolean {
    for (const p of patterns) {
      if (p.test(line)) return true;
    }
    return false;
  }

  private static firstCell(rowBody: string): string {
    const cells = rowBody.split("|");
    const first = cells[0] ?? "";
    return first.trim();
  }

  /**
   * Parses a single decision line. The expected shape is
   * `<title>: <rationale>` or just `<title>`. When no `:` is present
   * the entire line becomes both title and rationale (the curator's
   * consolidation will fold near-duplicates). Returns `null` when the
   * line is too short to qualify as a decision (`<5` chars after
   * trimming).
   */
  private static parseDecisionLine(line: string): ParsedHandoffDecision | null {
    if (line.length < 5) return null;
    // Strip leading id labels like "D-001 — " or "1. "
    const stripped = line.replace(/^(?:[A-Z]+-\d+\s*[—\-:]\s*)/u, "");
    const colonIdx = stripped.indexOf(":");
    let title: string;
    let rationale: string;
    if (colonIdx > 0 && colonIdx < 200) {
      title = stripped.slice(0, colonIdx).trim();
      rationale = stripped.slice(colonIdx + 1).trim();
    } else {
      title = stripped.slice(0, 200).trim();
      rationale = stripped;
    }
    if (title.length === 0) title = stripped.slice(0, 50);
    if (rationale.length === 0) rationale = title;
    return {
      title,
      rationale,
      tags: Tags.create(["handoff-import"]),
      confidence: 0.9,
    };
  }

  private static parseLearningLine(line: string): ParsedHandoffLearning {
    const upper = line.toUpperCase();
    const severity: "tip" | "warning" | "critical" = upper.includes("BUG")
      ? "warning"
      : upper.includes("BLOQUEADOR") || upper.includes("WARN")
        ? "warning"
        : upper.includes("CRIT")
          ? "critical"
          : "tip";
    return {
      text: line.slice(0, 2000),
      severity,
      tags: Tags.create(["handoff-import"]),
    };
  }

  private static parseTaskLine(line: string): ParsedHandoffTask {
    const upper = line.toUpperCase();
    const priority: "low" | "medium" | "high" | "critical" =
      upper.includes("URGENTE") || upper.includes("CRITICAL")
        ? "critical"
        : upper.includes("BLOQUEADOR") || upper.includes("HIGH")
          ? "high"
          : upper.includes("LOW")
            ? "low"
            : "medium";
    // Trim title to the first sentence/colon. Use the rest as the
    // description.
    const stripped = line.replace(/^(?:[A-Z]+-\d+\s*[—\-:]\s*)/u, "");
    const colonIdx = stripped.indexOf(":");
    let title: string;
    let description: string | null = null;
    if (colonIdx > 0 && colonIdx < 200) {
      title = stripped.slice(0, colonIdx).trim();
      const tail = stripped.slice(colonIdx + 1).trim();
      description = tail.length === 0 ? null : tail;
    } else {
      title = stripped.slice(0, 200).trim();
    }
    if (title.length === 0) title = stripped.slice(0, 50);
    return {
      title,
      description,
      priority,
      tags: Tags.create(["handoff-import"]),
    };
  }
}
