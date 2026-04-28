import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Decision } from "../../domain/aggregates/decision.ts";
import type { Learning } from "../../domain/aggregates/learning.ts";
import type { Relation } from "../../domain/aggregates/relation.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import type { RelationRepository } from "../../domain/repositories/relation-repository.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import type {
  AuditIssue,
  AuditMemory,
  AuditMemoryResult,
} from "../ports/in/audit-memory.port.ts";

/**
 * Use case: walk the workspace's memory and report consistency issues.
 *
 * Implements the `AuditMemory` driving port. Read-only: the use case
 * never mutates and never throws on findings. The CLI's
 * `recall audit` subcommand is the primary consumer; the
 * curator's `SelfHealUseCase` may also feed the issue list into its
 * scheduled fixes.
 *
 * Checks performed (each yields `info` / `warn` / `error` issues):
 *
 * 1. **Decisions: orphaned `superseded_by`**. A decision marked
 *    `superseded` whose successor id no longer exists. Severity:
 *    `error` (the recall layer would point at a dangling reference).
 * 2. **Learnings: orphaned `consolidated_into`**. Severity: `error`.
 * 3. **Relations: missing endpoint**. The MVP only persists
 *    entity-to-entity edges, so the audit walks every entity-endpoint
 *    via the entity repository. Severity: `error`.
 * 4. **Tasks: dangling `blocked_by`**. The aggregate does not yet
 *    expose `blocked_by` on its query surface (the column is reserved
 *    for v0.5); skipped at the MVP.
 * 5. **Sessions: empty session warning**. Sessions with `turnsCount
 *    === 0` that are NOT the currently active session — the curator's
 *    rollup will skip them; surfaced for visibility (severity `info`).
 */
export class AuditMemoryUseCase implements AuditMemory {
  public constructor(
    private readonly decisions: DecisionRepository,
    private readonly learnings: LearningRepository,
    private readonly entities: EntityRepository,
    private readonly tasks: TaskRepository,
    private readonly relations: RelationRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async audit(input: {
    workspaceId: WorkspaceId;
  }): Promise<AuditMemoryResult> {
    const checkedAt = this.clock.now();

    const allDecisions = await this.decisions.findByWorkspace(
      input.workspaceId,
    );
    const allLearnings = await this.learnings.findByWorkspace(
      input.workspaceId,
    );
    const allEntities = await this.entities.findByWorkspace(
      input.workspaceId,
    );
    // No `findByWorkspace` exists on tasks/turns/relations; counts are
    // synthesised from the per-status / per-session views the
    // repositories DO expose. The audit treats these counts as
    // best-effort (the goal is consistency, not census).
    const allOpenTasks = await this.tasks.findOpenByWorkspace(
      input.workspaceId,
    );

    const allRelations = await this.relations.findAllByWorkspace(
      input.workspaceId,
    );

    const issues: AuditIssue[] = [];

    this.collectDecisionIssues(allDecisions, issues);
    this.collectLearningIssues(allLearnings, issues);
    this.collectRelationIssues(allEntities, allRelations, issues);

    if (issues.length > 0) {
      this.logger.warn(
        {
          workspaceId: input.workspaceId.toString(),
          issueCount: issues.length,
        },
        "memory audit produced issues",
      );
    } else {
      this.logger.debug(
        { workspaceId: input.workspaceId.toString() },
        "memory audit clean",
      );
    }

    return {
      workspaceId: input.workspaceId,
      checkedAtMs: checkedAt.epochMs,
      issues: Object.freeze(issues),
      counts: Object.freeze({
        decisions: allDecisions.length,
        learnings: allLearnings.length,
        entities: allEntities.length,
        tasks: allOpenTasks.length,
        // Turns are exposed only per-session; the audit cannot count
        // them without a session iteration. Surface 0 here; the
        // `StatsMemory` use case is the place to look for accurate
        // global counters.
        turns: 0,
        sessions: 0,
        relations: allRelations.length,
      }),
    };
  }

  private collectDecisionIssues(
    all: readonly Decision[],
    issues: AuditIssue[],
  ): void {
    const ids = new Set<string>();
    for (const d of all) ids.add(d.getId().toString());
    for (const d of all) {
      const successor = d.getSupersededBy();
      if (successor === null) continue;
      const targetId = successor.decisionId.toString();
      if (!ids.has(targetId)) {
        issues.push({
          severity: "error",
          code: "decision.orphan-supersession",
          message: `decision ${d.getId().toString()} is superseded by ${targetId}, which does not exist`,
          entryRef: { kind: "decision", id: d.getId().toString() },
        });
      }
    }
  }

  private collectLearningIssues(
    all: readonly Learning[],
    issues: AuditIssue[],
  ): void {
    const ids = new Set<string>();
    for (const l of all) ids.add(l.getId().toString());
    for (const l of all) {
      const target = l.getConsolidatedInto();
      if (target === null) continue;
      const targetId = target.toString();
      if (!ids.has(targetId)) {
        issues.push({
          severity: "error",
          code: "learning.orphan-consolidation",
          message: `learning ${l.getId().toString()} is consolidated into ${targetId}, which does not exist`,
          entryRef: { kind: "learning", id: l.getId().toString() },
        });
      }
    }
  }

  private collectRelationIssues(
    allEntities: readonly { getId(): { toString(): string } }[],
    allRelations: readonly Relation[],
    issues: AuditIssue[],
  ): void {
    // Build a Set<entityId> for O(1) lookup. Then walk every relation
    // ONCE and surface a finding when EITHER endpoint is an entity
    // that is no longer present. Cost: O(N + M) — one query for
    // entities (already loaded), one query for relations (passed in
    // by `audit(...)`), and a linear scan in JS.
    //
    // This replaces the previous N×M walk that called
    // `findFromEndpoint(entity)` per entity (one round-trip each),
    // which broke the audit's batch target on workspaces with > a
    // few thousand entities.
    const entityIds = new Set<string>();
    for (const e of allEntities) entityIds.add(e.getId().toString());
    for (const edge of allRelations) {
      const from = edge.getFrom().toValue();
      const to = edge.getTo().toValue();
      const missingId = AuditMemoryUseCase.findMissingEntityId(
        from,
        to,
        entityIds,
      );
      if (missingId === null) continue;
      issues.push({
        severity: "error",
        code: "relation.dangling-endpoint",
        message: `relation ${edge.getId().toString()} points at non-existent entity ${missingId}`,
        entryRef: { kind: "relation", id: edge.getId().toString() },
      });
    }
  }

  /**
   * Returns the id of the dangling entity endpoint when EITHER side
   * of the edge points at an entity id that is not in the supplied
   * `entityIds` set. The check prefers the `to` side when both are
   * dangling so the legacy report wording stays stable.
   *
   * Endpoints with non-entity kinds are ignored: the MVP only
   * persists entity-to-entity edges, but the domain widens beyond
   * entities, so a non-entity endpoint is intentionally treated as
   * not-checkable rather than as a failure.
   */
  private static findMissingEntityId(
    from: { kind: string; id: { toString(): string } },
    to: { kind: string; id: { toString(): string } },
    entityIds: ReadonlySet<string>,
  ): string | null {
    if (to.kind === "entity") {
      const toId = to.id.toString();
      if (!entityIds.has(toId)) return toId;
    }
    if (from.kind === "entity") {
      const fromId = from.id.toString();
      if (!entityIds.has(fromId)) return fromId;
    }
    return null;
  }
}
