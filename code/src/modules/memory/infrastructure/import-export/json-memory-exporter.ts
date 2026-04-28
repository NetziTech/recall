import type { Decision } from "../../domain/aggregates/decision.ts";
import type { Entity } from "../../domain/aggregates/entity.ts";
import type { Learning } from "../../domain/aggregates/learning.ts";
import type { Relation } from "../../domain/aggregates/relation.ts";
import type { Session } from "../../domain/aggregates/session.ts";
import type { Task } from "../../domain/aggregates/task.ts";
import type { Turn } from "../../domain/aggregates/turn.ts";
import type {
  MemoryExporter,
  MemorySnapshot,
} from "../../application/ports/out/memory-exporter.port.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

/**
 * Wire-level schema version of the export envelope. Bumped whenever a
 * breaking change to the JSON shape lands. The importer rejects
 * envelopes with a different version unless an explicit migration is
 * added.
 */
const SCHEMA_VERSION = 1;

/**
 * JSON exporter for the memory module.
 *
 * Renders a `MemorySnapshot` as a UTF-8 JSON envelope with a stable
 * schema. The output round-trips byte-equivalent through
 * `JsonMemoryImporter.parse(...)` modulo array ordering inside each
 * kind (which is implementation-defined for stability across exports).
 */
export class JsonMemoryExporter implements MemoryExporter {
  public serialise(snapshot: MemorySnapshot): string {
    try {
      const envelope = {
        schemaVersion: SCHEMA_VERSION,
        decisions: snapshot.decisions.map((d) =>
          JsonMemoryExporter.serialiseDecision(d),
        ),
        learnings: snapshot.learnings.map((l) =>
          JsonMemoryExporter.serialiseLearning(l),
        ),
        entities: snapshot.entities.map((e) =>
          JsonMemoryExporter.serialiseEntity(e),
        ),
        tasks: snapshot.tasks.map((t) => JsonMemoryExporter.serialiseTask(t)),
        turns: snapshot.turns.map((t) => JsonMemoryExporter.serialiseTurn(t)),
        sessions: snapshot.sessions.map((s) =>
          JsonMemoryExporter.serialiseSession(s),
        ),
        relations: snapshot.relations.map((r) =>
          JsonMemoryExporter.serialiseRelation(r),
        ),
      };
      return JSON.stringify(envelope, null, 2);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.exportSerializeFailed(
        cause instanceof Error ? cause.message : "JSON serialisation failed",
        cause,
      );
    }
  }

  // -- per-kind serialisers --------------------------------------------

  private static serialiseDecision(d: Decision): unknown {
    return {
      id: d.getId().toString(),
      title: d.getTitle().toString(),
      rationale: d.getRationale().toString(),
      tags: d.getTags().toArray(),
      status: d.getStatus().toString(),
      supersededBy: d.getSupersededBy()?.decisionId.toString() ?? null,
      confidence: d.getConfidence().toNumber(),
      useCount: d.getUseCount().value,
      lastUsedMs:
        d.getLastUsed().kind === "at" && d.getLastUsed().at !== null
          ? d.getLastUsed().at?.toEpochMs() ?? null
          : null,
      scope: { kind: d.getScope().kind, module: d.getScope().module },
      embeddingStatus: d.getEmbeddingStatus().kind,
      createdAtMs: d.getCreatedAt().toEpochMs(),
      updatedAtMs: d.getUpdatedAt().toEpochMs(),
    };
  }

  private static serialiseLearning(l: Learning): unknown {
    return {
      id: l.getId().toString(),
      text: l.getText().toString(),
      severity: l.getSeverity().toString(),
      tags: l.getTags().toArray(),
      confidence: l.getConfidence().toNumber(),
      useCount: l.getUseCount().value,
      lastUsedMs:
        l.getLastUsed().kind === "at" && l.getLastUsed().at !== null
          ? l.getLastUsed().at?.toEpochMs() ?? null
          : null,
      scope: { kind: l.getScope().kind, module: l.getScope().module },
      embeddingStatus: l.getEmbeddingStatus().kind,
      consolidatedInto: l.getConsolidatedInto()?.toString() ?? null,
      createdAtMs: l.getCreatedAt().toEpochMs(),
      updatedAtMs: l.getUpdatedAt().toEpochMs(),
    };
  }

  private static serialiseEntity(e: Entity): unknown {
    return {
      id: e.getId().toString(),
      name: e.getName().toString(),
      kind: e.getKind().toString(),
      description: e.getDescription().toStringOrNull(),
      tags: e.getTags().toArray(),
      confidence: e.getConfidence().toNumber(),
      useCount: e.getUseCount().value,
      lastUsedMs:
        e.getLastUsed().kind === "at" && e.getLastUsed().at !== null
          ? e.getLastUsed().at?.toEpochMs() ?? null
          : null,
      scope: { kind: e.getScope().kind, module: e.getScope().module },
      embeddingStatus: e.getEmbeddingStatus().kind,
      createdAtMs: e.getCreatedAt().toEpochMs(),
      updatedAtMs: e.getUpdatedAt().toEpochMs(),
    };
  }

  private static serialiseTask(t: Task): unknown {
    return {
      id: t.getId().toString(),
      title: t.getTitle().toString(),
      description: t.getDescription()?.toString() ?? null,
      status: t.getStatus().toString(),
      priority: t.getPriority().toString(),
      tags: t.getTags().toArray(),
      dueAtMs: t.getDueAt()?.toEpochMs() ?? null,
      createdAtMs: t.getCreatedAt().toEpochMs(),
      updatedAtMs: t.getUpdatedAt().toEpochMs(),
      completedAtMs: t.getCompletedAt()?.toEpochMs() ?? null,
    };
  }

  private static serialiseTurn(t: Turn): unknown {
    return {
      id: t.getId().toString(),
      sessionId: t.getSessionId().toString(),
      summary: t.getSummary().toString(),
      intent: t.getIntent()?.toString() ?? null,
      outcome: t.getOutcome()?.toString() ?? null,
      filesTouched: t.getFilesTouched().toArray(),
      linkedDecisions: t
        .getLinkedDecisions()
        .toArray()
        .map((d) => d.toString()),
      linkedLearnings: t
        .getLinkedLearnings()
        .toArray()
        .map((l) => l.toString()),
      tags: t.getTags().toArray(),
      confidence: t.getConfidence().toNumber(),
      useCount: t.getUseCount().value,
      lastUsedMs:
        t.getLastUsed().kind === "at" && t.getLastUsed().at !== null
          ? t.getLastUsed().at?.toEpochMs() ?? null
          : null,
      createdAtMs: t.getCreatedAt().toEpochMs(),
    };
  }

  private static serialiseSession(s: Session): unknown {
    const openQuestions: { text: string; askedAtMs: number }[] = [];
    for (const q of s.getMetadata().openQuestions) {
      openQuestions.push({
        text: q.text.toString(),
        askedAtMs: q.askedAt.toEpochMs(),
      });
    }
    return {
      id: s.getId().toString(),
      startedAtMs: s.getStartedAt().toEpochMs(),
      endedAtMs: s.getEndedAt()?.toEpochMs() ?? null,
      lastActivityAtMs: s.getLastActivityAt().toEpochMs(),
      idleTimeoutMs: s.getIdleTimeoutMs(),
      intent: s.getIntent()?.toString() ?? null,
      summary: s.getSummary()?.toString() ?? null,
      nextSeed: s.getNextSeed()?.toString() ?? null,
      resumedFrom: s.getResumedFrom()?.toString() ?? null,
      turnsCount: s.getTurnsCount().toNumber(),
      openQuestions,
    };
  }

  private static serialiseRelation(r: Relation): unknown {
    return {
      id: r.getId().toString(),
      from: { kind: r.getFrom().kind, id: r.getFrom().idAsString() },
      to: { kind: r.getTo().kind, id: r.getTo().idAsString() },
      kind: r.getKind().toString(),
      weight: r.getWeight().toNumber(),
      createdAtMs: r.getCreatedAt().toEpochMs(),
    };
  }
}
