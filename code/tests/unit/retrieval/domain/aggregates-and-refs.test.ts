/**
 * Coverage-targeted tests for the retrieval domain aggregates and the
 * remaining value objects (typed *Refs, payloads, events).
 *
 * The existing `value-objects.test.ts` covers the simpler VOs; this
 * file covers the aggregates (`ContextBundle`, `RecallResult`,
 * `RankedEntry`), the layer wrapper (`ContextLayer`), the workspace
 * anchor payload, every typed ref (`Decision/Task/Turn/Entity/
 * MemoryRef`, `OpenQuestionRef`), the `RecallExecuted` and
 * `ContextBundleTruncated` events, and the
 * `LayerAlreadyPresentError`.
 */
import { describe, expect, it } from "vitest";

import { BundleId } from "../../../../src/modules/retrieval/domain/aggregates/bundle-id.ts";
import { ContextBundle } from "../../../../src/modules/retrieval/domain/aggregates/context-bundle.ts";
import { RankedEntry } from "../../../../src/modules/retrieval/domain/aggregates/ranked-entry.ts";
import { RecallResult } from "../../../../src/modules/retrieval/domain/aggregates/recall-result.ts";
import { BM25Score } from "../../../../src/modules/retrieval/domain/value-objects/bm25-score.ts";
import { CosineScore } from "../../../../src/modules/retrieval/domain/value-objects/cosine-score.ts";

import { LayerAlreadyPresentError } from "../../../../src/modules/retrieval/domain/errors/layer-already-present-error.ts";
import { TokenBudgetExceededError } from "../../../../src/modules/retrieval/domain/errors/token-budget-exceeded-error.ts";

import { ContextBundleTruncated } from "../../../../src/modules/retrieval/domain/events/context-bundle-truncated.ts";
import { RecallExecuted } from "../../../../src/modules/retrieval/domain/events/recall-executed.ts";

import { ContextLayer } from "../../../../src/modules/retrieval/domain/value-objects/context-layer.ts";
import { ContextLayerKind } from "../../../../src/modules/retrieval/domain/value-objects/context-layer-kind.ts";
import { DecisionRef } from "../../../../src/modules/retrieval/domain/value-objects/decision-ref.ts";
import { EntityRef } from "../../../../src/modules/retrieval/domain/value-objects/entity-ref.ts";
import { MemoryRef } from "../../../../src/modules/retrieval/domain/value-objects/memory-ref.ts";
import { OpenQuestionRef } from "../../../../src/modules/retrieval/domain/value-objects/open-question-ref.ts";
import { QueryKind } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { QueryText } from "../../../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { Query } from "../../../../src/modules/retrieval/domain/value-objects/query.ts";
import { RecallFilters } from "../../../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { RelevanceScore } from "../../../../src/modules/retrieval/domain/value-objects/relevance-score.ts";
import { TaskRef } from "../../../../src/modules/retrieval/domain/value-objects/task-ref.ts";
import { TokenBudget } from "../../../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { TurnRef } from "../../../../src/modules/retrieval/domain/value-objects/turn-ref.ts";
import { WorkspaceAnchorPayload } from "../../../../src/modules/retrieval/domain/value-objects/workspace-anchor-payload.ts";

import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { OpenQuestion } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { SessionIntent } from "../../../../src/modules/memory/domain/value-objects/session-intent.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import { TurnSummary } from "../../../../src/modules/memory/domain/value-objects/turn-summary.ts";

import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { NonEmptyString } from "../../../../src/shared/domain/value-objects/non-empty-string.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";

import {
  ANCHOR_TIME_MS,
  FIXED_BUNDLE_UUID,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_LEARNING_UUID,
  FIXED_SESSION_UUID,
  FIXED_TASK_UUID,
  FIXED_TURN_UUID,
  FIXED_WORKSPACE_UUID,
} from "../../../helpers/factories.ts";

// -- Common test helpers -------------------------------------------------

const ts = (epochMs: number = ANCHOR_TIME_MS): Timestamp =>
  Timestamp.fromEpochMs(epochMs);

const score = (n: number = 0.5): RelevanceScore => RelevanceScore.of(n);

const nonEmpty = (text: string): NonEmptyString =>
  NonEmptyString.create(text, "title");

const emptyTags = (): Tags => Tags.create([]);

const decisionRefSample = (id: string = FIXED_DECISION_UUID): DecisionRef =>
  DecisionRef.of({
    id: DecisionId.from(id),
    title: DecisionTitle.from("Use SQLCipher"),
    tags: emptyTags(),
    scope: Scope.project(),
    confidence: Confidence.of(0.9),
    relevanceScore: score(0.6),
  });

const taskRefSample = (id: string = FIXED_TASK_UUID): TaskRef =>
  TaskRef.of({
    id: TaskId.from(id),
    title: TaskTitle.from("ship feature"),
    status: TaskStatus.create("in_progress"),
    priority: TaskPriority.create("high"),
    tags: emptyTags(),
    relevanceScore: score(0.7),
  });

const turnRefSample = (id: string = FIXED_TURN_UUID): TurnRef =>
  TurnRef.of({
    id: TurnId.from(id),
    summary: TurnSummary.from("worked on retrieval"),
    recordedAt: ts(),
    confidence: Confidence.of(0.8),
    tags: emptyTags(),
    relevanceScore: score(0.5),
  });

const entityRefSample = (id: string = FIXED_ENTITY_UUID): EntityRef =>
  EntityRef.of({
    id: EntityId.from(id),
    name: EntityName.from("retrieval-module"),
    entityKind: EntityKind.create("module"),
    description: EntityDescription.of("hybrid recall pipeline"),
    location: "src/modules/retrieval",
    confidence: Confidence.of(0.7),
    relevanceScore: score(0.5),
  });

const memoryRefSample = (id: string = FIXED_LEARNING_UUID): MemoryRef =>
  MemoryRef.of({
    kind: QueryKind.learning(),
    id,
    title: nonEmpty("Always validate at boundary"),
    preview: nonEmpty("never trust external input"),
    tags: emptyTags(),
    confidence: Confidence.of(0.8),
    lastUsedAt: ts(),
    relevanceScore: score(0.4),
  });

const openQuestionRefSample = (text: string = "what about caching?"): OpenQuestionRef =>
  OpenQuestionRef.of({
    sessionId: SessionId.from(FIXED_SESSION_UUID),
    question: OpenQuestion.from(text, ts()),
    recordedAt: ts(),
  });

// -- BundleId ------------------------------------------------------------

describe("BundleId", () => {
  it("from() accepts a UUID v7 and round-trips toString()", () => {
    const id = BundleId.from(FIXED_BUNDLE_UUID);
    expect(id.toString()).toBe(FIXED_BUNDLE_UUID);
  });

  it("from() rejects malformed UUIDs", () => {
    expect(() => BundleId.from("not-a-uuid")).toThrow(InvalidInputError);
  });
});

// -- WorkspaceAnchorPayload ---------------------------------------------

describe("WorkspaceAnchorPayload", () => {
  const workspaceId = WorkspaceId.from(FIXED_WORKSPACE_UUID);
  const displayName = nonEmpty("My Workspace");

  it("of() builds a payload with all fields populated", () => {
    const payload = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("implement feature"),
      sessionStartedAt: ts(),
      metadata: { language: "ts" },
    });
    expect(payload.workspaceId).toBe(workspaceId);
    expect(payload.mode).toBe("shared");
    expect(payload.metadata.language).toBe("ts");
  });

  it("of() builds a payload with no active session", () => {
    const payload = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "encrypted",
      activeSessionId: null,
      activeSessionIntent: null,
      sessionStartedAt: null,
      metadata: {},
    });
    expect(payload.activeSessionId).toBeNull();
    expect(payload.activeSessionIntent).toBeNull();
    expect(payload.sessionStartedAt).toBeNull();
  });

  it("rejects unknown mode literals", () => {
    expect(() =>
      WorkspaceAnchorPayload.of({
        workspaceId,
        displayName,
        mode: "bogus" as "shared",
        activeSessionId: null,
        activeSessionIntent: null,
        sessionStartedAt: null,
        metadata: {},
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects sessionStartedAt without activeSessionId", () => {
    expect(() =>
      WorkspaceAnchorPayload.of({
        workspaceId,
        displayName,
        mode: "shared",
        activeSessionId: null,
        activeSessionIntent: null,
        sessionStartedAt: ts(),
        metadata: {},
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects activeSessionIntent without activeSessionId", () => {
    expect(() =>
      WorkspaceAnchorPayload.of({
        workspaceId,
        displayName,
        mode: "private",
        activeSessionId: null,
        activeSessionIntent: SessionIntent.from("orphan"),
        sessionStartedAt: null,
        metadata: {},
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string metadata values", () => {
    expect(() =>
      WorkspaceAnchorPayload.of({
        workspaceId,
        displayName,
        mode: "shared",
        activeSessionId: null,
        activeSessionIntent: null,
        sessionStartedAt: null,
        metadata: { count: 42 as unknown as string },
      }),
    ).toThrow(InvalidInputError);
  });

  it("isModeLabel() type-guard accepts known and rejects unknown", () => {
    expect(WorkspaceAnchorPayload.isModeLabel("shared")).toBe(true);
    expect(WorkspaceAnchorPayload.isModeLabel("encrypted")).toBe(true);
    expect(WorkspaceAnchorPayload.isModeLabel("private")).toBe(true);
    expect(WorkspaceAnchorPayload.isModeLabel("nope")).toBe(false);
  });

  it("equals() returns true for identical payloads", () => {
    const a = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    const b = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("equals() detects every field differing", () => {
    const base = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    // mode differs
    const diffMode = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "private",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffMode)).toBe(false);
    // session id differs
    const otherSessionId = "01952f3c-2222-7000-8000-999999999999";
    const diffSession = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(otherSessionId),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffSession)).toBe(false);
    // session present vs absent
    const noSession = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: null,
      activeSessionIntent: null,
      sessionStartedAt: null,
      metadata: { phase: "1" },
    });
    expect(base.equals(noSession)).toBe(false);
    expect(noSession.equals(base)).toBe(false);
    // intent text differs
    const diffIntent = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("other"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffIntent)).toBe(false);
    // sessionStartedAt differs
    const diffStartedAt = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(ANCHOR_TIME_MS + 1_000),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffStartedAt)).toBe(false);
    // displayName differs
    const diffName = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName: nonEmpty("Other"),
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffName)).toBe(false);
    // workspaceId differs
    const otherWsUuid = "01952f3b-7d8c-7000-8000-999999999999";
    const diffWs = WorkspaceAnchorPayload.of({
      workspaceId: WorkspaceId.from(otherWsUuid),
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1" },
    });
    expect(base.equals(diffWs)).toBe(false);
    // metadata size differs
    const diffMetaSize = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "1", language: "ts" },
    });
    expect(base.equals(diffMetaSize)).toBe(false);
    // metadata value differs
    const diffMetaValue = WorkspaceAnchorPayload.of({
      workspaceId,
      displayName,
      mode: "shared",
      activeSessionId: SessionId.from(FIXED_SESSION_UUID),
      activeSessionIntent: SessionIntent.from("intent"),
      sessionStartedAt: ts(),
      metadata: { phase: "2" },
    });
    expect(base.equals(diffMetaValue)).toBe(false);
  });
});

// -- Typed refs ----------------------------------------------------------

describe("DecisionRef", () => {
  it("of() builds a ref and equals() compares by id", () => {
    const a = decisionRefSample();
    const b = decisionRefSample();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("equals() returns false on a different id", () => {
    const otherId = "01952f3b-7d8c-7000-8000-eeeeeeeeeeee";
    const other = decisionRefSample(otherId);
    expect(decisionRefSample().equals(other)).toBe(false);
  });
});

describe("TaskRef", () => {
  it("of() + equals() round-trip", () => {
    const a = taskRefSample();
    const b = taskRefSample();
    expect(a.equals(b)).toBe(true);
  });

  it("equals() distinguishes different ids", () => {
    const otherId = "01952f3b-7d8c-7000-8000-aaaaaaaaaaab";
    expect(taskRefSample().equals(taskRefSample(otherId))).toBe(false);
  });
});

describe("TurnRef", () => {
  it("of() + equals() round-trip", () => {
    expect(turnRefSample().equals(turnRefSample())).toBe(true);
    expect(turnRefSample().equals(turnRefSample())).toBe(true);
  });

  it("equals() distinguishes different ids", () => {
    const otherId = "01952f3b-7d8c-7000-8000-aaaaaaaaaaad";
    expect(turnRefSample().equals(turnRefSample(otherId))).toBe(false);
  });
});

describe("EntityRef", () => {
  it("of() + equals() round-trip", () => {
    expect(entityRefSample().equals(entityRefSample())).toBe(true);
  });

  it("equals() distinguishes different ids", () => {
    const otherId = "01952f3b-7d8c-7000-8000-aaaaaaaaaaae";
    expect(entityRefSample().equals(entityRefSample(otherId))).toBe(false);
  });

  it("accepts location=null", () => {
    const ref = EntityRef.of({
      id: EntityId.from(FIXED_ENTITY_UUID),
      name: EntityName.from("svc"),
      entityKind: EntityKind.create("module"),
      description: EntityDescription.of("desc"),
      location: null,
      confidence: Confidence.of(1),
      relevanceScore: score(),
    });
    expect(ref.location).toBeNull();
  });
});

describe("MemoryRef", () => {
  it("of() + equals() round-trip", () => {
    expect(memoryRefSample().equals(memoryRefSample())).toBe(true);
  });

  it("equals() distinguishes by id and by kind", () => {
    expect(memoryRefSample().equals(memoryRefSample("other-id"))).toBe(false);
    const diffKind = MemoryRef.of({
      kind: QueryKind.decision(),
      id: FIXED_LEARNING_UUID,
      title: nonEmpty("title"),
      preview: nonEmpty("preview"),
      tags: emptyTags(),
      confidence: Confidence.of(0.5),
      lastUsedAt: null,
      relevanceScore: score(),
    });
    expect(memoryRefSample().equals(diffKind)).toBe(false);
  });

  it("rejects empty / non-string id", () => {
    expect(() =>
      MemoryRef.of({
        kind: QueryKind.learning(),
        id: "   ",
        title: nonEmpty("t"),
        preview: nonEmpty("p"),
        tags: emptyTags(),
        confidence: Confidence.of(1),
        lastUsedAt: null,
        relevanceScore: score(),
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      MemoryRef.of({
        kind: QueryKind.learning(),
        id: 42 as unknown as string,
        title: nonEmpty("t"),
        preview: nonEmpty("p"),
        tags: emptyTags(),
        confidence: Confidence.of(1),
        lastUsedAt: null,
        relevanceScore: score(),
      }),
    ).toThrow(InvalidInputError);
  });
});

describe("OpenQuestionRef", () => {
  it("of() builds and equals() compares by (sessionId, question)", () => {
    const a = openQuestionRefSample();
    const b = openQuestionRefSample();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("equals() returns false on different question text", () => {
    expect(
      openQuestionRefSample("a?").equals(openQuestionRefSample("b?")),
    ).toBe(false);
  });

  it("equals() returns false on different sessionId", () => {
    const otherSession = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
    const a = openQuestionRefSample();
    const b = OpenQuestionRef.of({
      sessionId: SessionId.from(otherSession),
      question: OpenQuestion.from("what about caching?", ts()),
      recordedAt: ts(),
    });
    expect(a.equals(b)).toBe(false);
  });
});

// -- RankedEntry ---------------------------------------------------------

describe("RankedEntry", () => {
  const baseInput = {
    kind: QueryKind.decision(),
    id: FIXED_DECISION_UUID,
    title: nonEmpty("decision A"),
    preview: nonEmpty("preview text"),
    tags: emptyTags(),
    relevanceScore: score(0.6),
    bm25Score: null,
    cosineScore: null,
    createdAt: ts(),
    lastUsedAt: null,
  } as const;

  it("of() builds a ranked entry", () => {
    const e = RankedEntry.of({ ...baseInput });
    expect(e.id).toBe(FIXED_DECISION_UUID);
    expect(e.isHybridScored()).toBe(false);
  });

  it("rejects empty / non-string id", () => {
    expect(() =>
      RankedEntry.of({ ...baseInput, id: "  " }),
    ).toThrow(InvalidInputError);
    expect(() =>
      RankedEntry.of({ ...baseInput, id: 1 as unknown as string }),
    ).toThrow(InvalidInputError);
  });

  it("isHybridScored() reports true only when both scores are non-null", () => {
    const both = RankedEntry.of({
      ...baseInput,
      bm25Score: BM25Score.of(1.5),
      cosineScore: CosineScore.of(0.8),
    });
    expect(both.isHybridScored()).toBe(true);
    const onlyBm25 = RankedEntry.of({
      ...baseInput,
      bm25Score: BM25Score.of(1.5),
      cosineScore: null,
    });
    expect(onlyBm25.isHybridScored()).toBe(false);
  });

  it("equals() compares by (kind, id)", () => {
    const a = RankedEntry.of({ ...baseInput });
    const b = RankedEntry.of({ ...baseInput });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    const otherId = "01952f3b-7d8c-7000-8000-bbbbbbbbbbbc";
    const c = RankedEntry.of({ ...baseInput, id: otherId });
    expect(a.equals(c)).toBe(false);
    const diffKind = RankedEntry.of({ ...baseInput, kind: QueryKind.learning() });
    expect(a.equals(diffKind)).toBe(false);
  });
});

// -- ContextLayer --------------------------------------------------------

describe("ContextLayer", () => {
  it("workspaceAnchor factory carries payload + tokens + entriesCount", () => {
    const payload = WorkspaceAnchorPayload.of({
      workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
      displayName: nonEmpty("ws"),
      mode: "shared",
      activeSessionId: null,
      activeSessionIntent: null,
      sessionStartedAt: null,
      metadata: {},
    });
    const layer = ContextLayer.workspaceAnchor({
      payload,
      tokens: Tokens.of(50),
    });
    expect(layer.kind()).toBe("workspace_anchor");
    expect(layer.kindVO().value).toBe("workspace_anchor");
    expect(layer.tokens().toNumber()).toBe(50);
    expect(layer.entriesCount()).toBe(1);
    expect(layer.toValue().kind).toBe("workspace_anchor");
  });

  it("workspaceAnchor with null payload has entriesCount 0", () => {
    const layer = ContextLayer.workspaceAnchor({
      payload: null,
      tokens: Tokens.of(10),
    });
    expect(layer.entriesCount()).toBe(0);
  });

  it("activeDecisions factory builds a frozen array layer", () => {
    const layer = ContextLayer.activeDecisions({
      payload: [decisionRefSample()],
      tokens: Tokens.of(20),
    });
    expect(layer.kind()).toBe("active_decisions");
    expect(layer.entriesCount()).toBe(1);
  });

  it("openTasks factory works", () => {
    const layer = ContextLayer.openTasks({
      payload: [taskRefSample()],
      tokens: Tokens.of(30),
    });
    expect(layer.kind()).toBe("open_tasks");
    expect(layer.entriesCount()).toBe(1);
  });

  it("recentTurns factory works", () => {
    const layer = ContextLayer.recentTurns({
      payload: [turnRefSample()],
      tokens: Tokens.of(40),
    });
    expect(layer.kind()).toBe("recent_turns");
  });

  it("relevantMemory factory works", () => {
    const layer = ContextLayer.relevantMemory({
      payload: [memoryRefSample()],
      tokens: Tokens.of(50),
    });
    expect(layer.kind()).toBe("relevant_memory");
  });

  it("entitiesInFocus factory works", () => {
    const layer = ContextLayer.entitiesInFocus({
      payload: [entityRefSample()],
      tokens: Tokens.of(60),
    });
    expect(layer.kind()).toBe("entities_in_focus");
  });

  it("openQuestions factory works", () => {
    const layer = ContextLayer.openQuestions({
      payload: [openQuestionRefSample()],
      tokens: Tokens.of(70),
    });
    expect(layer.kind()).toBe("open_questions");
  });

  it("equals: same payload + tokens → equal (workspace_anchor with payload)", () => {
    const payload = WorkspaceAnchorPayload.of({
      workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
      displayName: nonEmpty("ws"),
      mode: "shared",
      activeSessionId: null,
      activeSessionIntent: null,
      sessionStartedAt: null,
      metadata: {},
    });
    const a = ContextLayer.workspaceAnchor({ payload, tokens: Tokens.of(10) });
    const b = ContextLayer.workspaceAnchor({ payload, tokens: Tokens.of(10) });
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals: workspace_anchor null vs null → equal; null vs non-null → not", () => {
    const nullA = ContextLayer.workspaceAnchor({ payload: null, tokens: Tokens.of(0) });
    const nullB = ContextLayer.workspaceAnchor({ payload: null, tokens: Tokens.of(0) });
    expect(nullA.equals(nullB)).toBe(true);
    const nonNull = ContextLayer.workspaceAnchor({
      payload: WorkspaceAnchorPayload.of({
        workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
        displayName: nonEmpty("ws"),
        mode: "shared",
        activeSessionId: null,
        activeSessionIntent: null,
        sessionStartedAt: null,
        metadata: {},
      }),
      tokens: Tokens.of(0),
    });
    expect(nullA.equals(nonNull)).toBe(false);
    expect(nonNull.equals(nullA)).toBe(false);
  });

  it("equals: different kinds → false", () => {
    const a = ContextLayer.activeDecisions({ payload: [decisionRefSample()], tokens: Tokens.of(10) });
    const b = ContextLayer.openTasks({ payload: [taskRefSample()], tokens: Tokens.of(10) });
    expect(a.equals(b)).toBe(false);
  });

  it("equals: same kind, different tokens → false", () => {
    const a = ContextLayer.openTasks({ payload: [taskRefSample()], tokens: Tokens.of(10) });
    const b = ContextLayer.openTasks({ payload: [taskRefSample()], tokens: Tokens.of(11) });
    expect(a.equals(b)).toBe(false);
  });

  it("equals: same kind, different payload length → false", () => {
    const a = ContextLayer.openTasks({ payload: [taskRefSample()], tokens: Tokens.of(10) });
    const b = ContextLayer.openTasks({ payload: [], tokens: Tokens.of(10) });
    expect(a.equals(b)).toBe(false);
  });

  it("equals across all array-shaped layer kinds", () => {
    // active_decisions: equal
    const ad1 = ContextLayer.activeDecisions({
      payload: [decisionRefSample()],
      tokens: Tokens.of(1),
    });
    const ad2 = ContextLayer.activeDecisions({
      payload: [decisionRefSample()],
      tokens: Tokens.of(1),
    });
    expect(ad1.equals(ad2)).toBe(true);
    // open_tasks: equal
    const ot1 = ContextLayer.openTasks({
      payload: [taskRefSample()],
      tokens: Tokens.of(1),
    });
    const ot2 = ContextLayer.openTasks({
      payload: [taskRefSample()],
      tokens: Tokens.of(1),
    });
    expect(ot1.equals(ot2)).toBe(true);
    // recent_turns: equal
    const rt1 = ContextLayer.recentTurns({
      payload: [turnRefSample()],
      tokens: Tokens.of(1),
    });
    const rt2 = ContextLayer.recentTurns({
      payload: [turnRefSample()],
      tokens: Tokens.of(1),
    });
    expect(rt1.equals(rt2)).toBe(true);
    // relevant_memory: equal
    const rm1 = ContextLayer.relevantMemory({
      payload: [memoryRefSample()],
      tokens: Tokens.of(1),
    });
    const rm2 = ContextLayer.relevantMemory({
      payload: [memoryRefSample()],
      tokens: Tokens.of(1),
    });
    expect(rm1.equals(rm2)).toBe(true);
    // entities_in_focus: equal
    const ef1 = ContextLayer.entitiesInFocus({
      payload: [entityRefSample()],
      tokens: Tokens.of(1),
    });
    const ef2 = ContextLayer.entitiesInFocus({
      payload: [entityRefSample()],
      tokens: Tokens.of(1),
    });
    expect(ef1.equals(ef2)).toBe(true);
    // open_questions: equal
    const oq1 = ContextLayer.openQuestions({
      payload: [openQuestionRefSample()],
      tokens: Tokens.of(1),
    });
    const oq2 = ContextLayer.openQuestions({
      payload: [openQuestionRefSample()],
      tokens: Tokens.of(1),
    });
    expect(oq1.equals(oq2)).toBe(true);
  });
});

// -- ContextBundle -------------------------------------------------------

describe("ContextBundle", () => {
  const id = BundleId.from(FIXED_BUNDLE_UUID);
  const workspaceId = WorkspaceId.from(FIXED_WORKSPACE_UUID);
  const tokenBudget = TokenBudget.withMax(1_000);

  const makeBundle = (): ContextBundle =>
    ContextBundle.assemble({
      id,
      workspaceId,
      sessionId: null,
      query: null,
      tokenBudget,
      occurredAt: ts(),
    });

  it("assemble emits a ContextBundleAssembled event with 0 layers / 0 tokens", () => {
    const bundle = makeBundle();
    const events = bundle.pullEvents();
    expect(events.length).toBe(1);
    expect(bundle.layersCount()).toBe(0);
    expect(bundle.getId().equals(id)).toBe(true);
    expect(bundle.getWorkspaceId().equals(workspaceId)).toBe(true);
    expect(bundle.getSessionId()).toBeNull();
    expect(bundle.getQuery()).toBeNull();
    expect(bundle.getAssembledAt().equals(ts())).toBe(true);
    // pull again returns frozen empty
    const empty = bundle.pullEvents();
    expect(empty.length).toBe(0);
  });

  it("addLayer appends, emits ContextLayerAdded, updates token budget", () => {
    const bundle = makeBundle();
    bundle.pullEvents(); // drain initial event
    const layer = ContextLayer.activeDecisions({
      payload: [decisionRefSample()],
      tokens: Tokens.of(100),
    });
    bundle.addLayer({ layer, occurredAt: ts() });
    expect(bundle.layersCount()).toBe(1);
    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
    expect(bundle.findLayer("active_decisions")?.kind()).toBe("active_decisions");
    expect(bundle.findLayer("open_tasks")).toBeNull();
    expect(bundle.getTokenBudget().usedTokens).toBe(100);
    const events = bundle.pullEvents();
    expect(events.length).toBe(1);
  });

  it("addLayer rejects a duplicate kind with LayerAlreadyPresentError", () => {
    const bundle = makeBundle();
    const layer1 = ContextLayer.openTasks({
      payload: [taskRefSample()],
      tokens: Tokens.of(50),
    });
    const layer2 = ContextLayer.openTasks({
      payload: [],
      tokens: Tokens.of(0),
    });
    bundle.addLayer({ layer: layer1, occurredAt: ts() });
    expect(() =>
      bundle.addLayer({ layer: layer2, occurredAt: ts() }),
    ).toThrow(LayerAlreadyPresentError);
  });

  it("addLayer refuses when budget would be exceeded", () => {
    const tight = ContextBundle.assemble({
      id,
      workspaceId,
      sessionId: null,
      query: null,
      tokenBudget: TokenBudget.withMax(100),
      occurredAt: ts(),
    });
    const big = ContextLayer.openTasks({
      payload: [],
      tokens: Tokens.of(150),
    });
    expect(() =>
      tight.addLayer({ layer: big, occurredAt: ts() }),
    ).toThrow(TokenBudgetExceededError);
    // bundle state stays intact
    expect(tight.layersCount()).toBe(0);
  });

  it("getLayers returns layers in canonical priority order regardless of insertion order", () => {
    const bundle = makeBundle();
    bundle.addLayer({
      layer: ContextLayer.openQuestions({
        payload: [openQuestionRefSample()],
        tokens: Tokens.of(20),
      }),
      occurredAt: ts(),
    });
    bundle.addLayer({
      layer: ContextLayer.activeDecisions({
        payload: [decisionRefSample()],
        tokens: Tokens.of(30),
      }),
      occurredAt: ts(),
    });
    const layers = bundle.getLayers();
    expect(layers[0]?.kind()).toBe("active_decisions");
    expect(layers[1]?.kind()).toBe("open_questions");
  });

  it("truncate is a no-op when within budget", () => {
    const bundle = makeBundle();
    bundle.addLayer({
      layer: ContextLayer.activeDecisions({
        payload: [decisionRefSample()],
        tokens: Tokens.of(50),
      }),
      occurredAt: ts(),
    });
    bundle.pullEvents();
    bundle.truncate({ newMaxTokens: 1_000, occurredAt: ts() });
    // No new events
    expect(bundle.pullEvents().length).toBe(0);
    expect(bundle.layersCount()).toBe(1);
  });

  it("truncate drops lowest-priority layers and emits ContextBundleTruncated", () => {
    const bundle = makeBundle();
    bundle.addLayer({
      layer: ContextLayer.activeDecisions({
        payload: [decisionRefSample()],
        tokens: Tokens.of(100),
      }),
      occurredAt: ts(),
    });
    bundle.addLayer({
      layer: ContextLayer.openTasks({
        payload: [taskRefSample()],
        tokens: Tokens.of(100),
      }),
      occurredAt: ts(),
    });
    bundle.addLayer({
      layer: ContextLayer.openQuestions({
        payload: [openQuestionRefSample()],
        tokens: Tokens.of(100),
      }),
      occurredAt: ts(),
    });
    expect(bundle.getTokenBudget().usedTokens).toBe(300);
    bundle.pullEvents();
    bundle.truncate({ newMaxTokens: 150, occurredAt: ts() });
    const events = bundle.pullEvents();
    expect(events.length).toBe(1);
    const ev = events[0] as ContextBundleTruncated;
    expect(ev.eventName).toBe("retrieval.context-bundle-truncated");
    expect(ev.droppedLayers.length).toBeGreaterThan(0);
    // After truncation, the running used tokens fits the cap and the
    // bundle must contain at least workspace_anchor-level priority
    // (active_decisions kept, open_questions dropped first).
    expect(bundle.getTokenBudget().usedTokens).toBeLessThanOrEqual(150);
    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
    expect(bundle.hasLayerOfKind("open_questions")).toBe(false);
  });

  it("rehydrate creates a bundle with no events", () => {
    const layer = ContextLayer.activeDecisions({
      payload: [decisionRefSample()],
      tokens: Tokens.of(40),
    });
    const re = ContextBundle.rehydrate({
      id,
      workspaceId,
      sessionId: null,
      query: null,
      layers: [layer],
      tokenBudget: TokenBudget.of({ maxTokens: 1000, usedTokens: 40 }),
      assembledAt: ts(),
    });
    expect(re.layersCount()).toBe(1);
    expect(re.pullEvents().length).toBe(0);
  });

  it("assemble + truncate carry the query payload", () => {
    const query = Query.create({
      text: QueryText.create("hello"),
      kinds: [],
      tags: emptyTags(),
      mustHaveTags: emptyTags(),
      mustNotHaveTags: emptyTags(),
      includeSuperseded: false,
    });
    const bundle = ContextBundle.assemble({
      id,
      workspaceId,
      sessionId: SessionId.from(FIXED_SESSION_UUID),
      query,
      tokenBudget,
      occurredAt: ts(),
    });
    expect(bundle.getQuery()?.text.toString()).toBe("hello");
    expect(bundle.getSessionId()?.toString()).toBe(FIXED_SESSION_UUID);
  });
});

// -- LayerAlreadyPresentError -------------------------------------------

describe("LayerAlreadyPresentError", () => {
  it("carries the offending layer kind and stable code", () => {
    const e = new LayerAlreadyPresentError("active_decisions");
    expect(e.code).toBe("retrieval.layer-already-present");
    expect(e.layerKind).toBe("active_decisions");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.message).toContain("active_decisions");
  });

  it("optionally accepts a cause", () => {
    const cause = new Error("inner");
    const e = new LayerAlreadyPresentError("open_tasks", { cause });
    expect(e.cause).toBe(cause);
  });
});

// -- RecallResult --------------------------------------------------------

describe("RecallResult", () => {
  const filters = RecallFilters.create({
    kinds: [],
    tags: emptyTags(),
    mustHaveTags: emptyTags(),
    mustNotHaveTags: emptyTags(),
    minConfidence: null,
    since: null,
    until: null,
    limit: 8,
  });
  const baseRanked = RankedEntry.of({
    kind: QueryKind.decision(),
    id: FIXED_DECISION_UUID,
    title: nonEmpty("a"),
    preview: nonEmpty("p"),
    tags: emptyTags(),
    relevanceScore: score(),
    bm25Score: null,
    cosineScore: null,
    createdAt: ts(),
    lastUsedAt: null,
  });

  it("of() builds a result with no fallback", () => {
    const r = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(r.getEntries().length).toBe(1);
    expect(r.hasFallback()).toBe(false);
  });

  it("of() builds a result with a recognised fallback", () => {
    const r = RecallResult.of({
      query: null,
      filters,
      entries: [],
      totalCandidates: 0,
      totalTokens: Tokens.zero(),
      fallbackReason: "no_embeddings_yet",
      executedAt: ts(),
    });
    expect(r.hasFallback()).toBe(true);
    expect(r.fallbackReason).toBe("no_embeddings_yet");
  });

  it("rejects non-finite totalCandidates", () => {
    expect(() =>
      RecallResult.of({
        query: null,
        filters,
        entries: [],
        totalCandidates: Number.POSITIVE_INFINITY,
        totalTokens: Tokens.zero(),
        fallbackReason: null,
        executedAt: ts(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-integer totalCandidates", () => {
    expect(() =>
      RecallResult.of({
        query: null,
        filters,
        entries: [],
        totalCandidates: 1.5,
        totalTokens: Tokens.zero(),
        fallbackReason: null,
        executedAt: ts(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects negative totalCandidates", () => {
    expect(() =>
      RecallResult.of({
        query: null,
        filters,
        entries: [],
        totalCandidates: -1,
        totalTokens: Tokens.zero(),
        fallbackReason: null,
        executedAt: ts(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects entries.length > totalCandidates", () => {
    expect(() =>
      RecallResult.of({
        query: null,
        filters,
        entries: [baseRanked],
        totalCandidates: 0,
        totalTokens: Tokens.zero(),
        fallbackReason: null,
        executedAt: ts(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects unrecognised fallbackReason", () => {
    expect(() =>
      RecallResult.of({
        query: null,
        filters,
        entries: [],
        totalCandidates: 0,
        totalTokens: Tokens.zero(),
        fallbackReason: "unknown" as never,
        executedAt: ts(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("isFallbackReason() type-guard accepts known and rejects unknown", () => {
    expect(RecallResult.isFallbackReason("no_embeddings_yet")).toBe(true);
    expect(RecallResult.isFallbackReason("embedder_unavailable")).toBe(true);
    expect(RecallResult.isFallbackReason("nope")).toBe(false);
  });

  it("equals() returns true for identical results", () => {
    const a = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    const b = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals() detects every divergent field", () => {
    const a = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    // totalCandidates differs
    const diffCand = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 2,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(diffCand)).toBe(false);
    // fallbackReason differs (null vs non-null)
    const diffFallback = RecallResult.of({
      query: null,
      filters,
      entries: [],
      totalCandidates: 0,
      totalTokens: Tokens.zero(),
      fallbackReason: "embedder_unavailable",
      executedAt: ts(),
    });
    expect(a.equals(diffFallback)).toBe(false);
    // totalTokens differs
    const diffTokens = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(11),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(diffTokens)).toBe(false);
    // executedAt differs
    const diffWhen = RecallResult.of({
      query: null,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(ANCHOR_TIME_MS + 1_000),
    });
    expect(a.equals(diffWhen)).toBe(false);
    // filters differ (different limit)
    const diffFilters = RecallFilters.create({
      kinds: [],
      tags: emptyTags(),
      mustHaveTags: emptyTags(),
      mustNotHaveTags: emptyTags(),
      minConfidence: null,
      since: null,
      until: null,
      limit: 16,
    });
    const diffFiltersResult = RecallResult.of({
      query: null,
      filters: diffFilters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(diffFiltersResult)).toBe(false);
    // query null vs non-null
    const queryHello = Query.create({
      text: QueryText.create("hello"),
      kinds: [],
      tags: emptyTags(),
      mustHaveTags: emptyTags(),
      mustNotHaveTags: emptyTags(),
      includeSuperseded: false,
    });
    const withQuery = RecallResult.of({
      query: queryHello,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(withQuery)).toBe(false);
    expect(withQuery.equals(a)).toBe(false);
    // both with the same query
    const withQuery2 = RecallResult.of({
      query: queryHello,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(withQuery.equals(withQuery2)).toBe(true);
    // both with different queries
    const queryWorld = Query.create({
      text: QueryText.create("world"),
      kinds: [],
      tags: emptyTags(),
      mustHaveTags: emptyTags(),
      mustNotHaveTags: emptyTags(),
      includeSuperseded: false,
    });
    const withQueryB = RecallResult.of({
      query: queryWorld,
      filters,
      entries: [baseRanked],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(withQuery.equals(withQueryB)).toBe(false);
    // different number of entries
    const noEntries = RecallResult.of({
      query: null,
      filters,
      entries: [],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(noEntries)).toBe(false);
    // different entry id
    const otherEntry = RankedEntry.of({
      kind: QueryKind.decision(),
      id: "01952f3b-7d8c-7000-8000-bbbbbbbbbbbc",
      title: nonEmpty("a"),
      preview: nonEmpty("p"),
      tags: emptyTags(),
      relevanceScore: score(),
      bm25Score: null,
      cosineScore: null,
      createdAt: ts(),
      lastUsedAt: null,
    });
    const diffEntries = RecallResult.of({
      query: null,
      filters,
      entries: [otherEntry],
      totalCandidates: 1,
      totalTokens: Tokens.of(10),
      fallbackReason: null,
      executedAt: ts(),
    });
    expect(a.equals(diffEntries)).toBe(false);
  });
});

// -- Events --------------------------------------------------------------

describe("ContextBundleTruncated event", () => {
  it("carries every field, freezes droppedLayers", () => {
    const id = BundleId.from(FIXED_BUNDLE_UUID);
    const event = new ContextBundleTruncated({
      bundleId: id,
      droppedLayers: ["open_questions"],
      tokensReclaimed: Tokens.of(10),
      tokensBefore: Tokens.of(20),
      tokensAfter: Tokens.of(10),
      occurredAt: ts(),
    });
    expect(event.eventName).toBe("retrieval.context-bundle-truncated");
    expect(event.bundleId.equals(id)).toBe(true);
    expect(event.droppedLayers.length).toBe(1);
    // Frozen
    expect(Object.isFrozen(event.droppedLayers)).toBe(true);
  });
});

describe("RecallExecuted event", () => {
  it("carries every field including fallback", () => {
    const event = new RecallExecuted({
      workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
      queryText: "hello",
      entriesReturned: 3,
      totalCandidates: 7,
      totalTokens: Tokens.of(120),
      fallbackReason: "embedder_unavailable",
      durationMs: 42,
      occurredAt: ts(),
    });
    expect(event.eventName).toBe("retrieval.recall-executed");
    expect(event.queryText).toBe("hello");
    expect(event.entriesReturned).toBe(3);
    expect(event.totalCandidates).toBe(7);
    expect(event.fallbackReason).toBe("embedder_unavailable");
    expect(event.durationMs).toBe(42);
  });

  it("accepts null queryText and null fallback", () => {
    const event = new RecallExecuted({
      workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
      queryText: null,
      entriesReturned: 0,
      totalCandidates: 0,
      totalTokens: Tokens.zero(),
      fallbackReason: null,
      durationMs: 0,
      occurredAt: ts(),
    });
    expect(event.queryText).toBeNull();
    expect(event.fallbackReason).toBeNull();
  });
});

// -- ContextLayerKind extra coverage -----------------------------------

describe("ContextLayerKind.create non-string input", () => {
  it("rejects non-string", () => {
    expect(() =>
      ContextLayerKind.create(null as unknown as string),
    ).toThrow(InvalidInputError);
  });
});
