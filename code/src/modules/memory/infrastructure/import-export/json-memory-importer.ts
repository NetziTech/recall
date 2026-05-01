import { z } from "zod";

import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Decision } from "../../domain/aggregates/decision.ts";
import { Entity } from "../../domain/aggregates/entity.ts";
import { Learning } from "../../domain/aggregates/learning.ts";
import { Relation } from "../../domain/aggregates/relation.ts";
import { Session } from "../../domain/aggregates/session.ts";
import { Task } from "../../domain/aggregates/task.ts";
import { Turn } from "../../domain/aggregates/turn.ts";
import type {
  MemoryExporter,
  MemorySnapshot,
} from "../../application/ports/out/memory-exporter.port.ts";
import type { MemoryImporter } from "../../application/ports/out/memory-importer.port.ts";
import { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { DecisionStatus } from "../../domain/value-objects/decision-status.ts";
import { DecisionTitle } from "../../domain/value-objects/decision-title.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { EntityDescription } from "../../domain/value-objects/entity-description.ts";
import { EntityId } from "../../domain/value-objects/entity-id.ts";
import { EntityKind } from "../../domain/value-objects/entity-kind.ts";
import { EntityName } from "../../domain/value-objects/entity-name.ts";
import { FilesTouched } from "../../domain/value-objects/files-touched.ts";
import { LastUsed } from "../../domain/value-objects/last-used.ts";
import { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../domain/value-objects/learning-severity.ts";
import { LearningText } from "../../domain/value-objects/learning-text.ts";
import { LinkedDecisionIds } from "../../domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../domain/value-objects/linked-learning-ids.ts";
import { OpenQuestion } from "../../domain/value-objects/open-question.ts";
import { DecisionContent } from "../../domain/value-objects/decision-content.ts";
import { Rationale } from "../../domain/value-objects/rationale.ts";
import { RelationEndpoint } from "../../domain/value-objects/relation-endpoint.ts";
import { RelationId } from "../../domain/value-objects/relation-id.ts";
import { RelationKind } from "../../domain/value-objects/relation-kind.ts";
import { Scope } from "../../domain/value-objects/scope.ts";
import { SessionId } from "../../domain/value-objects/session-id.ts";
import { SessionIntent } from "../../domain/value-objects/session-intent.ts";
import { SessionMetadata } from "../../domain/value-objects/session-metadata.ts";
import { SessionNextSeed } from "../../domain/value-objects/session-next-seed.ts";
import { SessionSummary } from "../../domain/value-objects/session-summary.ts";
import { SupersededBy } from "../../domain/value-objects/superseded-by.ts";
import { TaskDescription } from "../../domain/value-objects/task-description.ts";
import { TaskId } from "../../domain/value-objects/task-id.ts";
import { TaskPriority } from "../../domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../domain/value-objects/task-status.ts";
import { TaskTitle } from "../../domain/value-objects/task-title.ts";
import { TurnId } from "../../domain/value-objects/turn-id.ts";
import { TurnIntent } from "../../domain/value-objects/turn-intent.ts";
import { TurnOutcome } from "../../domain/value-objects/turn-outcome.ts";
import { TurnSummary } from "../../domain/value-objects/turn-summary.ts";
import { TurnsCount } from "../../domain/value-objects/turns-count.ts";
import { UseCount } from "../../domain/value-objects/use-count.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

// ─── Zod schemas for the wire envelope ────────────────────────────────

const SUPPORTED_SCHEMA_VERSION = 1;

const ScopeSchema = z.object({
  kind: z.string().min(1),
  module: z.string().nullable(),
});

const DecisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string(),
  // Optional in the import schema for backward compat with v0.1.0/0.1.1
  // exports that predate the `content` column (B-MCP-4). When absent,
  // `buildDecision` falls back to `rationale`.
  content: z.string().optional(),
  tags: z.array(z.string().min(1)),
  status: z.string().min(1),
  supersededBy: z.string().nullable(),
  confidence: z.number(),
  useCount: z.number().int().min(0),
  lastUsedMs: z.number().int().min(0).nullable(),
  scope: ScopeSchema,
  embeddingStatus: z.string().min(1),
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
});

const LearningSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  severity: z.string().min(1),
  tags: z.array(z.string().min(1)),
  confidence: z.number(),
  useCount: z.number().int().min(0),
  lastUsedMs: z.number().int().min(0).nullable(),
  scope: ScopeSchema,
  embeddingStatus: z.string().min(1),
  consolidatedInto: z.string().nullable(),
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
});

const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  confidence: z.number(),
  useCount: z.number().int().min(0),
  lastUsedMs: z.number().int().min(0).nullable(),
  scope: ScopeSchema,
  embeddingStatus: z.string().min(1),
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
});

const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.string().min(1),
  priority: z.string().min(1),
  tags: z.array(z.string().min(1)),
  dueAtMs: z.number().int().min(0).nullable(),
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
  completedAtMs: z.number().int().min(0).nullable(),
});

const TurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  summary: z.string().min(1),
  intent: z.string().nullable(),
  outcome: z.string().nullable(),
  filesTouched: z.array(z.string().min(1)),
  linkedDecisions: z.array(z.string().min(1)),
  linkedLearnings: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
  confidence: z.number(),
  useCount: z.number().int().min(0),
  lastUsedMs: z.number().int().min(0).nullable(),
  createdAtMs: z.number().int().min(0),
});

const SessionSchema = z.object({
  id: z.string().min(1),
  startedAtMs: z.number().int().min(0),
  endedAtMs: z.number().int().min(0).nullable(),
  lastActivityAtMs: z.number().int().min(0),
  idleTimeoutMs: z.number().int().min(1),
  intent: z.string().nullable(),
  summary: z.string().nullable(),
  nextSeed: z.string().nullable(),
  resumedFrom: z.string().nullable(),
  turnsCount: z.number().int().min(0),
  openQuestions: z.array(
    z.object({
      text: z.string().min(1),
      askedAtMs: z.number().int().min(0),
    }),
  ),
});

const RelationEndpointSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

const RelationSchema = z.object({
  id: z.string().min(1),
  from: RelationEndpointSchema,
  to: RelationEndpointSchema,
  kind: z.string().min(1),
  weight: z.number(),
  createdAtMs: z.number().int().min(0),
});

const EnvelopeSchema = z.object({
  schemaVersion: z.number().int(),
  decisions: z.array(DecisionSchema),
  learnings: z.array(LearningSchema),
  entities: z.array(EntitySchema),
  tasks: z.array(TaskSchema),
  turns: z.array(TurnSchema),
  sessions: z.array(SessionSchema),
  relations: z.array(RelationSchema),
});

/**
 * JSON importer for the memory module.
 *
 * Pairs with `JsonMemoryExporter`. Validates the envelope and every
 * row via Zod before invoking the domain factories. Failures surface
 * as `MemoryInfrastructureError.importParseFailed(...)`.
 *
 * Round-trip: when fed the output of `MemoryExporter.serialise(...)`,
 * the importer reproduces the snapshot byte-for-byte modulo array
 * ordering (which is implementation-defined for stability). Cross-
 * workspace imports re-pin every aggregate's `workspaceId` to the
 * supplied `input.workspaceId`.
 */
export class JsonMemoryImporter implements MemoryImporter {
  /**
   * @internal exposed for symmetry with the exporter; nominal coupling
   * is `JsonMemoryExporter` ↔ `JsonMemoryImporter` via the wire schema.
   */
  public readonly exporterContract: MemoryExporter | null = null;

  public parse(input: { json: string; workspaceId: WorkspaceId }): MemorySnapshot {
    let decoded: unknown;
    try {
      decoded = JSON.parse(input.json);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.importParseFailed(
        `JSON.parse failed: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }

    let envelope: z.infer<typeof EnvelopeSchema>;
    try {
      envelope = EnvelopeSchema.parse(decoded);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.importParseFailed(
        cause instanceof Error ? cause.message : "envelope schema mismatch",
        cause,
      );
    }
    if (envelope.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      throw MemoryInfrastructureError.importParseFailed(
        `unsupported schemaVersion: ${String(envelope.schemaVersion)} (expected ${String(SUPPORTED_SCHEMA_VERSION)})`,
      );
    }

    return {
      decisions: Object.freeze(
        envelope.decisions.map((d) => this.buildDecision(d, input.workspaceId)),
      ),
      learnings: Object.freeze(
        envelope.learnings.map((l) => this.buildLearning(l, input.workspaceId)),
      ),
      entities: Object.freeze(
        envelope.entities.map((e) => this.buildEntity(e, input.workspaceId)),
      ),
      tasks: Object.freeze(
        envelope.tasks.map((t) => this.buildTask(t, input.workspaceId)),
      ),
      turns: Object.freeze(
        envelope.turns.map((t) => this.buildTurn(t, input.workspaceId)),
      ),
      sessions: Object.freeze(
        envelope.sessions.map((s) => this.buildSession(s, input.workspaceId)),
      ),
      relations: Object.freeze(
        envelope.relations.map((r) =>
          this.buildRelation(r, input.workspaceId),
        ),
      ),
    };
  }

  // -- per-kind builders ------------------------------------------------

  private buildDecision(
    d: z.infer<typeof DecisionSchema>,
    workspaceId: WorkspaceId,
  ): Decision {
    return Decision.rehydrate({
      id: DecisionId.from(d.id),
      workspaceId,
      sessionId: null,
      title: DecisionTitle.from(d.title),
      rationale: Rationale.from(d.rationale),
      // Legacy exports (pre-B-MCP-4) lack `content`; fall back to
      // rationale so the rehydration preserves the searchable text.
      content: DecisionContent.from(d.content ?? d.rationale),
      tags: this.buildTags(d.tags),
      status: DecisionStatus.create(d.status),
      supersededBy:
        d.supersededBy === null ? null : SupersededBy.fromRaw(d.supersededBy),
      confidence: Confidence.of(d.confidence),
      useCount: UseCount.of(d.useCount),
      lastUsed:
        d.lastUsedMs === null
          ? LastUsed.never()
          : LastUsed.at(Timestamp.fromEpochMs(d.lastUsedMs)),
      scope: this.buildScope(d.scope),
      embeddingStatus: EmbeddingStatus.create(d.embeddingStatus),
      createdAt: Timestamp.fromEpochMs(d.createdAtMs),
      updatedAt: Timestamp.fromEpochMs(d.updatedAtMs),
    });
  }

  private buildLearning(
    l: z.infer<typeof LearningSchema>,
    workspaceId: WorkspaceId,
  ): Learning {
    return Learning.rehydrate({
      id: LearningId.from(l.id),
      workspaceId,
      text: LearningText.from(l.text),
      severity: LearningSeverity.create(l.severity),
      tags: this.buildTags(l.tags),
      confidence: Confidence.of(l.confidence),
      useCount: UseCount.of(l.useCount),
      lastUsed:
        l.lastUsedMs === null
          ? LastUsed.never()
          : LastUsed.at(Timestamp.fromEpochMs(l.lastUsedMs)),
      scope: this.buildScope(l.scope),
      embeddingStatus: EmbeddingStatus.create(l.embeddingStatus),
      consolidatedInto:
        l.consolidatedInto === null
          ? null
          : LearningId.from(l.consolidatedInto),
      createdAt: Timestamp.fromEpochMs(l.createdAtMs),
      updatedAt: Timestamp.fromEpochMs(l.updatedAtMs),
    });
  }

  private buildEntity(
    e: z.infer<typeof EntitySchema>,
    workspaceId: WorkspaceId,
  ): Entity {
    const description =
      e.description === null || e.description.length === 0
        ? EntityDescription.unknown()
        : EntityDescription.of(e.description);
    return Entity.rehydrate({
      id: EntityId.from(e.id),
      workspaceId,
      name: EntityName.from(e.name),
      kind: EntityKind.create(e.kind),
      description,
      tags: this.buildTags(e.tags),
      confidence: Confidence.of(e.confidence),
      useCount: UseCount.of(e.useCount),
      lastUsed:
        e.lastUsedMs === null
          ? LastUsed.never()
          : LastUsed.at(Timestamp.fromEpochMs(e.lastUsedMs)),
      scope: this.buildScope(e.scope),
      embeddingStatus: EmbeddingStatus.create(e.embeddingStatus),
      createdAt: Timestamp.fromEpochMs(e.createdAtMs),
      updatedAt: Timestamp.fromEpochMs(e.updatedAtMs),
    });
  }

  private buildTask(
    t: z.infer<typeof TaskSchema>,
    workspaceId: WorkspaceId,
  ): Task {
    return Task.rehydrate({
      id: TaskId.from(t.id),
      workspaceId,
      sessionId: null,
      title: TaskTitle.from(t.title),
      description:
        t.description === null || t.description.length === 0
          ? null
          : TaskDescription.from(t.description),
      status: TaskStatus.create(t.status),
      priority: TaskPriority.create(t.priority),
      tags: this.buildTags(t.tags),
      dueAt: t.dueAtMs === null ? null : Timestamp.fromEpochMs(t.dueAtMs),
      createdAt: Timestamp.fromEpochMs(t.createdAtMs),
      updatedAt: Timestamp.fromEpochMs(t.updatedAtMs),
      completedAt:
        t.completedAtMs === null
          ? null
          : Timestamp.fromEpochMs(t.completedAtMs),
    });
  }

  private buildTurn(
    t: z.infer<typeof TurnSchema>,
    workspaceId: WorkspaceId,
  ): Turn {
    return Turn.rehydrate({
      id: TurnId.from(t.id),
      workspaceId,
      sessionId: SessionId.from(t.sessionId),
      summary: TurnSummary.from(t.summary),
      intent: t.intent === null ? null : TurnIntent.from(t.intent),
      outcome: t.outcome === null ? null : TurnOutcome.from(t.outcome),
      filesTouched:
        t.filesTouched.length === 0
          ? FilesTouched.empty()
          : FilesTouched.create(t.filesTouched),
      linkedDecisions:
        t.linkedDecisions.length === 0
          ? LinkedDecisionIds.empty()
          : LinkedDecisionIds.create(
              t.linkedDecisions.map((s) => DecisionId.from(s)),
            ),
      linkedLearnings:
        t.linkedLearnings.length === 0
          ? LinkedLearningIds.empty()
          : LinkedLearningIds.create(
              t.linkedLearnings.map((s) => LearningId.from(s)),
            ),
      tags: this.buildTags(t.tags),
      confidence: Confidence.of(t.confidence),
      useCount: UseCount.of(t.useCount),
      lastUsed:
        t.lastUsedMs === null
          ? LastUsed.never()
          : LastUsed.at(Timestamp.fromEpochMs(t.lastUsedMs)),
      createdAt: Timestamp.fromEpochMs(t.createdAtMs),
    });
  }

  private buildSession(
    s: z.infer<typeof SessionSchema>,
    workspaceId: WorkspaceId,
  ): Session {
    const openQuestions: OpenQuestion[] = [];
    for (const q of s.openQuestions) {
      openQuestions.push(
        OpenQuestion.from(q.text, Timestamp.fromEpochMs(q.askedAtMs)),
      );
    }
    return Session.rehydrate({
      id: SessionId.from(s.id),
      workspaceId,
      startedAt: Timestamp.fromEpochMs(s.startedAtMs),
      endedAt: s.endedAtMs === null ? null : Timestamp.fromEpochMs(s.endedAtMs),
      lastActivityAt: Timestamp.fromEpochMs(s.lastActivityAtMs),
      idleTimeoutMs: s.idleTimeoutMs,
      intent: s.intent === null ? null : SessionIntent.from(s.intent),
      summary: s.summary === null ? null : SessionSummary.from(s.summary),
      nextSeed: s.nextSeed === null ? null : SessionNextSeed.from(s.nextSeed),
      resumedFrom: s.resumedFrom === null ? null : SessionId.from(s.resumedFrom),
      turnsCount: TurnsCount.of(s.turnsCount),
      metadata: SessionMetadata.of(openQuestions),
    });
  }

  private buildRelation(
    r: z.infer<typeof RelationSchema>,
    workspaceId: WorkspaceId,
  ): Relation {
    return Relation.rehydrate({
      id: RelationId.from(r.id),
      workspaceId,
      from: RelationEndpoint.create(r.from.kind, r.from.id),
      to: RelationEndpoint.create(r.to.kind, r.to.id),
      kind: RelationKind.create(r.kind),
      weight: Confidence.of(r.weight),
      createdAt: Timestamp.fromEpochMs(r.createdAtMs),
    });
  }

  private buildScope(raw: { kind: string; module: string | null }): Scope {
    return Scope.create(raw.kind, raw.module);
  }

  private buildTags(raw: readonly string[]): Tags {
    if (raw.length === 0) return Tags.empty();
    return Tags.create(raw);
  }
}
