import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Decision } from "../../domain/aggregates/decision.ts";
import { Learning } from "../../domain/aggregates/learning.ts";
import { Task } from "../../domain/aggregates/task.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../domain/value-objects/decision-title.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../domain/value-objects/learning-severity.ts";
import { LearningText } from "../../domain/value-objects/learning-text.ts";
import { DecisionContent } from "../../domain/value-objects/decision-content.ts";
import { Rationale } from "../../domain/value-objects/rationale.ts";
import { Scope } from "../../domain/value-objects/scope.ts";
import { TaskDescription } from "../../domain/value-objects/task-description.ts";
import { TaskId } from "../../domain/value-objects/task-id.ts";
import { TaskPriority } from "../../domain/value-objects/task-priority.ts";
import { TaskTitle } from "../../domain/value-objects/task-title.ts";
import type {
  ImportHandoff,
  ImportHandoffResult,
} from "../ports/in/import-handoff.port.ts";
import type { HandoffParser } from "../ports/out/handoff-parser.port.ts";

/**
 * Use case: turn a `HANDOFF.md` document into seed memory.
 *
 * Implements the `ImportHandoff` driving port. The use case asks the
 * `HandoffParser` to crack the markdown into a typed bag, then walks
 * each kind to build aggregates and persist them.
 *
 * Defaults applied on every imported aggregate:
 * - `scope`           : `project`.
 * - `confidence`      : whatever the parser supplied (decisions),
 *                       or 1.0 (learnings, tasks).
 * - `embeddingStatus` : `pending` (the curator's nightly pass picks
 *                       these up the same way it would for live
 *                       writes).
 *
 * Atomicity: every aggregate is built first (pure construction, no
 * I/O) and then ALL saves run inside a SINGLE SQLite transaction so
 * the import either applies in full or rolls back, and the per-row
 * fsync cost is paid once at COMMIT (better-sqlite3 transactions are
 * synchronous; the repository adapters wrap synchronous SQL in
 * `Promise.resolve(...)` so `save` already performed its side effect
 * by the time it returns — see
 * `code/src/shared/application/ports/database-connection.port.ts`).
 *
 * No embedding-enqueue is performed on this path: the operator may
 * import a handoff into an offline workspace; the curator's
 * background pass detects the missing vectors and re-queues them.
 *
 * Events are NOT published: like `ImportMemory`, an import is a state
 * restoration, not a stream of new business facts.
 */
export class ImportHandoffUseCase implements ImportHandoff {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly parser: HandoffParser,
    private readonly decisions: DecisionRepository,
    private readonly learnings: LearningRepository,
    private readonly tasks: TaskRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public import(input: {
    workspaceId: WorkspaceId;
    markdown: string;
  }): Promise<ImportHandoffResult> {
    const importedAt = this.clock.now();
    const parsed = this.parser.parse(input.markdown);

    const projectScope = Scope.project();

    // Build every aggregate in memory first. Aggregate construction
    // is pure (no I/O), so we can do it before opening the
    // transaction. The transaction window only wraps the persistence
    // step.
    const decisionsToPersist: Decision[] = [];
    for (const d of parsed.decisions) {
      const decision = Decision.record({
        id: DecisionId.from(this.idGen.generateString()),
        workspaceId: input.workspaceId,
        sessionId: null,
        title: DecisionTitle.from(d.title),
        rationale: Rationale.from(d.rationale),
        // Handoff parser predates the `content` column (B-MCP-4 fix);
        // reuse rationale as the long-form body so the rehydration
        // path stays well-formed.
        content: DecisionContent.from(d.rationale),
        tags: d.tags,
        confidence: Confidence.of(d.confidence),
        scope: projectScope,
        embeddingStatus: EmbeddingStatus.pending(),
        occurredAt: importedAt,
      });
      // Drain the events buffer so that future operations on the
      // aggregate (none, here) start from a clean state.
      decision.pullEvents();
      decisionsToPersist.push(decision);
    }

    const learningsToPersist: Learning[] = [];
    for (const l of parsed.learnings) {
      const learning = Learning.register({
        id: LearningId.from(this.idGen.generateString()),
        workspaceId: input.workspaceId,
        text: LearningText.from(l.text),
        severity: LearningSeverity.create(l.severity),
        tags: l.tags,
        confidence: Confidence.full(),
        scope: projectScope,
        embeddingStatus: EmbeddingStatus.pending(),
        occurredAt: importedAt,
      });
      learning.pullEvents();
      learningsToPersist.push(learning);
    }

    const tasksToPersist: Task[] = [];
    for (const t of parsed.tasks) {
      const task = Task.create({
        id: TaskId.from(this.idGen.generateString()),
        workspaceId: input.workspaceId,
        sessionId: null,
        title: TaskTitle.from(t.title),
        description:
          t.description === null ||
          t.description.trim().length === 0
            ? null
            : TaskDescription.from(t.description),
        priority: TaskPriority.create(t.priority),
        tags: t.tags,
        dueAt: null,
        occurredAt: importedAt,
      });
      task.pullEvents();
      tasksToPersist.push(task);
    }

    // One sync transaction wrapping every save. The repository
    // adapters' `save(...)` Promises are already resolved by the time
    // they return (better-sqlite3 is sync), so `void`-ing them is
    // safe within the closure.
    this.db.transaction((): void => {
      for (const decision of decisionsToPersist) {
        void this.decisions.save(decision);
      }
      for (const learning of learningsToPersist) {
        void this.learnings.save(learning);
      }
      for (const task of tasksToPersist) {
        void this.tasks.save(task);
      }
    });

    const counts = Object.freeze({
      decisions: decisionsToPersist.length,
      learnings: learningsToPersist.length,
      tasks: tasksToPersist.length,
    });
    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        importedAtMs: importedAt.epochMs,
        ...counts,
        skipped: parsed.skipped.length,
      },
      "HANDOFF.md import completed",
    );

    return Promise.resolve({
      workspaceId: input.workspaceId,
      importedAtMs: importedAt.epochMs,
      counts,
      skipped: parsed.skipped,
    });
  }
}
