/**
 * Bundled tests for memory-domain VOs (one VO per describe block).
 */
import { describe, expect, it } from "vitest";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { RelationId } from "../../../../src/modules/memory/domain/value-objects/relation-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TurnIntent } from "../../../../src/modules/memory/domain/value-objects/turn-intent.ts";
import { TurnSummary } from "../../../../src/modules/memory/domain/value-objects/turn-summary.ts";
import { TurnOutcome } from "../../../../src/modules/memory/domain/value-objects/turn-outcome.ts";
import { TurnsCount } from "../../../../src/modules/memory/domain/value-objects/turns-count.ts";
import { FilesTouched } from "../../../../src/modules/memory/domain/value-objects/files-touched.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { DecisionStatus } from "../../../../src/modules/memory/domain/value-objects/decision-status.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { SupersededBy } from "../../../../src/modules/memory/domain/value-objects/superseded-by.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  FIXED_ENTITY_UUID,
  FIXED_TASK_UUID,
  FIXED_TURN_UUID,
  FIXED_SESSION_UUID,
  FIXED_RELATION_UUID,
  makeTimestamp,
} from "../../../helpers/factories.ts";

describe("brand id VOs", () => {
  it("DecisionId.from accepts valid UUID v7", () => {
    expect(DecisionId.from(FIXED_DECISION_UUID).toString()).toBe(
      FIXED_DECISION_UUID,
    );
  });

  it("DecisionId.from rejects invalid", () => {
    expect(() => DecisionId.from("not-a-uuid")).toThrow(InvalidInputError);
  });

  it("LearningId / EntityId / TaskId / TurnId / SessionId / RelationId construct", () => {
    expect(LearningId.from(FIXED_LEARNING_UUID).toString()).toBe(
      FIXED_LEARNING_UUID,
    );
    expect(EntityId.from(FIXED_ENTITY_UUID).toString()).toBe(FIXED_ENTITY_UUID);
    expect(TaskId.from(FIXED_TASK_UUID).toString()).toBe(FIXED_TASK_UUID);
    expect(TurnId.from(FIXED_TURN_UUID).toString()).toBe(FIXED_TURN_UUID);
    expect(SessionId.from(FIXED_SESSION_UUID).toString()).toBe(
      FIXED_SESSION_UUID,
    );
    expect(RelationId.from(FIXED_RELATION_UUID).toString()).toBe(
      FIXED_RELATION_UUID,
    );
  });
});

describe("DecisionTitle", () => {
  it("trims and accepts non-empty", () => {
    expect(DecisionTitle.from("  Use SQLCipher  ").toString()).toBe(
      "Use SQLCipher",
    );
  });

  it("rejects empty", () => {
    expect(() => DecisionTitle.from("")).toThrow(InvalidInputError);
  });

  it("rejects too-long (>200 chars)", () => {
    expect(() => DecisionTitle.from("x".repeat(201))).toThrow(InvalidInputError);
  });

  it("rejects newlines", () => {
    expect(() => DecisionTitle.from("a\nb")).toThrow(InvalidInputError);
    expect(() => DecisionTitle.from("a\rb")).toThrow(InvalidInputError);
  });
});

describe("Rationale", () => {
  it("trims and accepts multi-line", () => {
    expect(Rationale.from("a\nb").toString()).toBe("a\nb");
  });

  it("rejects empty", () => {
    expect(() => Rationale.from("")).toThrow(InvalidInputError);
  });

  it("rejects too-long (>5000 chars)", () => {
    expect(() => Rationale.from("x".repeat(5001))).toThrow(InvalidInputError);
  });
});

describe("LearningText", () => {
  it("accepts up to 2000 chars", () => {
    expect(LearningText.from("x".repeat(2000)).toString().length).toBe(2000);
  });

  it("rejects too-long", () => {
    expect(() => LearningText.from("x".repeat(2001))).toThrow(InvalidInputError);
  });

  it("rejects empty", () => {
    expect(() => LearningText.from("   ")).toThrow(InvalidInputError);
  });
});

describe("LearningSeverity", () => {
  it("factories", () => {
    expect(LearningSeverity.tip().isTip()).toBe(true);
    expect(LearningSeverity.warning().isWarning()).toBe(true);
    expect(LearningSeverity.critical().isCritical()).toBe(true);
  });

  it("rank ordering", () => {
    expect(LearningSeverity.critical().isAtLeast(LearningSeverity.warning()))
      .toBe(true);
    expect(LearningSeverity.tip().isAtLeast(LearningSeverity.warning()))
      .toBe(false);
  });

  it("create rejects unknown / empty", () => {
    expect(() => LearningSeverity.create("nope")).toThrow(InvalidInputError);
    expect(() => LearningSeverity.create("")).toThrow(InvalidInputError);
    expect(() =>
      LearningSeverity.create(null as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("isKind type guard", () => {
    expect(LearningSeverity.isKind("tip")).toBe(true);
    expect(LearningSeverity.isKind("nope")).toBe(false);
  });
});

describe("EntityName", () => {
  it("trims, rejects empty / too-long / newlines", () => {
    expect(EntityName.from("  Foo ").toString()).toBe("Foo");
    expect(() => EntityName.from("")).toThrow(InvalidInputError);
    expect(() => EntityName.from("x".repeat(201))).toThrow(InvalidInputError);
    expect(() => EntityName.from("a\nb")).toThrow(InvalidInputError);
  });
});

describe("EntityKind", () => {
  it("factories cover all kinds", () => {
    expect(EntityKind.functionKind().toString()).toBe("function");
    expect(EntityKind.classKind().toString()).toBe("class");
    expect(EntityKind.moduleKind().toString()).toBe("module");
    expect(EntityKind.serviceKind().toString()).toBe("service");
    expect(EntityKind.libraryKind().toString()).toBe("library");
    expect(EntityKind.conceptKind().toString()).toBe("concept");
    expect(EntityKind.personKind().toString()).toBe("person");
    expect(EntityKind.teamKind().toString()).toBe("team");
  });

  it("create rejects bad inputs", () => {
    expect(() => EntityKind.create("")).toThrow(InvalidInputError);
    expect(() => EntityKind.create("widget")).toThrow(InvalidInputError);
    expect(() =>
      EntityKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("TaskStatus", () => {
  it("factories cover all statuses", () => {
    expect(TaskStatus.todo().isTodo()).toBe(true);
    expect(TaskStatus.inProgress().isInProgress()).toBe(true);
    expect(TaskStatus.done().isDone()).toBe(true);
    expect(TaskStatus.blocked().isBlocked()).toBe(true);
  });

  it("isOpen returns true for non-done", () => {
    expect(TaskStatus.todo().isOpen()).toBe(true);
    expect(TaskStatus.inProgress().isOpen()).toBe(true);
    expect(TaskStatus.blocked().isOpen()).toBe(true);
    expect(TaskStatus.done().isOpen()).toBe(false);
  });

  it("create accepts known kinds (DOMAIN gap: schema uses 'pending', domain uses 'todo')", () => {
    expect(TaskStatus.create("todo").isTodo()).toBe(true);
    expect(TaskStatus.create("in_progress").isInProgress()).toBe(true);
    // Note: schema default is 'pending' per migration 004; the persistence
    // adapter must translate 'pending' <-> 'todo'. This bug is also
    // documented in src/modules/memory/domain/value-objects/task-status.ts
    // JSDoc.
    expect(() => TaskStatus.create("pending")).toThrow(InvalidInputError);
  });

  it("create rejects empty / non-string / unknown", () => {
    expect(() => TaskStatus.create("")).toThrow(InvalidInputError);
    expect(() =>
      TaskStatus.create(null as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("TaskPriority", () => {
  it("factories", () => {
    expect(TaskPriority.low().rank()).toBe(0);
    expect(TaskPriority.medium().rank()).toBe(1);
    expect(TaskPriority.high().rank()).toBe(2);
    expect(TaskPriority.critical().rank()).toBe(3);
  });

  it("isHigherThan", () => {
    expect(TaskPriority.critical().isHigherThan(TaskPriority.high())).toBe(true);
    expect(TaskPriority.medium().isHigherThan(TaskPriority.high())).toBe(false);
  });

  it("create rejects bad inputs", () => {
    expect(() => TaskPriority.create("nope")).toThrow(InvalidInputError);
    expect(() => TaskPriority.create("")).toThrow(InvalidInputError);
    expect(() =>
      TaskPriority.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("TurnIntent / TurnSummary / TurnOutcome", () => {
  it("TurnIntent caps at 1000", () => {
    expect(TurnIntent.from("x".repeat(1000)).toString().length).toBe(1000);
    expect(() => TurnIntent.from("x".repeat(1001))).toThrow(InvalidInputError);
  });

  it("TurnSummary trims", () => {
    expect(TurnSummary.from("  done  ").toString()).toBe("done");
  });

  it("TurnOutcome caps at 2000", () => {
    expect(TurnOutcome.from("x".repeat(2000)).toString().length).toBe(2000);
    expect(() => TurnOutcome.from("x".repeat(2001))).toThrow(InvalidInputError);
  });
});

describe("TurnsCount / UseCount", () => {
  it("zero / increment / equals", () => {
    expect(TurnsCount.zero().toNumber()).toBe(0);
    expect(TurnsCount.zero().increment().toNumber()).toBe(1);
    expect(TurnsCount.zero().isZero()).toBe(true);
    expect(TurnsCount.of(5).equals(TurnsCount.of(5))).toBe(true);
  });

  it("of rejects bad values", () => {
    expect(() => TurnsCount.of(-1)).toThrow(InvalidInputError);
    expect(() => TurnsCount.of(1.5)).toThrow(InvalidInputError);
    expect(() => TurnsCount.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("UseCount zero / increment", () => {
    expect(UseCount.zero().toNumber()).toBe(0);
    expect(UseCount.zero().increment().toNumber()).toBe(1);
  });

  it("UseCount.of rejects bad", () => {
    expect(() => UseCount.of(-1)).toThrow(InvalidInputError);
    expect(() => UseCount.of(0.5)).toThrow(InvalidInputError);
    expect(() => UseCount.of(Number.NaN)).toThrow(InvalidInputError);
  });
});

describe("FilesTouched", () => {
  it("empty + create + size + isEmpty", () => {
    expect(FilesTouched.empty().isEmpty()).toBe(true);
    const f = FilesTouched.create(["a.ts", "b.ts"]);
    expect(f.size()).toBe(2);
  });

  it("trims values", () => {
    expect(FilesTouched.create(["  a.ts  "]).toArray()).toEqual(["a.ts"]);
  });

  it("rejects duplicates", () => {
    expect(() => FilesTouched.create(["a", "a"])).toThrow(InvalidInputError);
  });

  it("rejects empty / whitespace path", () => {
    expect(() => FilesTouched.create([""])).toThrow(InvalidInputError);
    expect(() => FilesTouched.create(["   "])).toThrow(InvalidInputError);
  });

  it("rejects too-long path", () => {
    expect(() => FilesTouched.create(["x".repeat(4001)])).toThrow(
      InvalidInputError,
    );
  });

  it("rejects non-string", () => {
    expect(() =>
      FilesTouched.create([123 as unknown as string]),
    ).toThrow(InvalidInputError);
  });

  it("contains compares trimmed", () => {
    const f = FilesTouched.create(["a.ts"]);
    expect(f.contains(" a.ts ")).toBe(true);
    expect(f.contains("b.ts")).toBe(false);
  });

  it("equals reflects elements + ordering", () => {
    expect(
      FilesTouched.create(["a", "b"]).equals(FilesTouched.create(["a", "b"])),
    ).toBe(true);
    expect(
      FilesTouched.create(["a", "b"]).equals(FilesTouched.create(["b", "a"])),
    ).toBe(false);
  });
});

describe("Scope", () => {
  it("project factory", () => {
    expect(Scope.project().isProject()).toBe(true);
    expect(Scope.project().module).toBe(null);
  });

  it("module factory trims", () => {
    expect(Scope.module("  auth  ").module).toBe("auth");
    expect(Scope.module("auth").isModule()).toBe(true);
  });

  it("module rejects empty / too-long", () => {
    expect(() => Scope.module("")).toThrow(InvalidInputError);
    expect(() => Scope.module("x".repeat(201))).toThrow(InvalidInputError);
  });

  it("create accepts kind+name", () => {
    expect(Scope.create("module", "auth").module).toBe("auth");
    expect(Scope.create("project", null).isProject()).toBe(true);
  });

  it("create rejects bad kind / missing module name", () => {
    expect(() => Scope.create("nope", null)).toThrow(InvalidInputError);
    expect(() => Scope.create("module", null)).toThrow(InvalidInputError);
    expect(() =>
      Scope.create("module", "" as unknown as string),
    ).toThrow(InvalidInputError);
    expect(() =>
      Scope.create(123 as unknown as string, null),
    ).toThrow(InvalidInputError);
  });

  it("toValue returns discriminated union", () => {
    const proj = Scope.project().toValue();
    expect(proj.kind).toBe("project");
    const mod = Scope.module("auth").toValue();
    expect(mod.kind).toBe("module");
    if (mod.kind === "module") expect(mod.module).toBe("auth");
  });

  it("isKind type guard", () => {
    expect(Scope.isKind("project")).toBe(true);
    expect(Scope.isKind("nope")).toBe(false);
  });

  it("equals", () => {
    expect(Scope.project().equals(Scope.project())).toBe(true);
    expect(Scope.module("a").equals(Scope.module("a"))).toBe(true);
    expect(Scope.module("a").equals(Scope.module("b"))).toBe(false);
    expect(Scope.module("a").equals(Scope.project())).toBe(false);
  });
});

describe("DecisionStatus", () => {
  it("active / superseded factories", () => {
    expect(DecisionStatus.active().isActive()).toBe(true);
    expect(DecisionStatus.superseded().isSuperseded()).toBe(true);
  });

  it("create rejects bad inputs", () => {
    expect(() => DecisionStatus.create("")).toThrow(InvalidInputError);
    expect(() => DecisionStatus.create("nope")).toThrow(InvalidInputError);
    expect(() =>
      DecisionStatus.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("create accepts known kinds", () => {
    expect(DecisionStatus.create("active").isActive()).toBe(true);
    expect(DecisionStatus.create("superseded").isSuperseded()).toBe(true);
  });
});

describe("EmbeddingStatus", () => {
  it("factories", () => {
    expect(EmbeddingStatus.pending().isPending()).toBe(true);
    expect(EmbeddingStatus.ready().isReady()).toBe(true);
    expect(EmbeddingStatus.failed().isFailed()).toBe(true);
  });

  it("create rejects bad", () => {
    expect(() => EmbeddingStatus.create("queued")).toThrow(InvalidInputError);
    expect(() => EmbeddingStatus.create("")).toThrow(InvalidInputError);
    expect(() =>
      EmbeddingStatus.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("LastUsed", () => {
  it("never / at / touch", () => {
    const n = LastUsed.never();
    expect(n.hasBeenUsed()).toBe(false);
    expect(n.toValue().kind).toBe("never");
    const a = n.touch(makeTimestamp());
    expect(a.hasBeenUsed()).toBe(true);
  });

  it("millisecondsSince returns null for never", () => {
    expect(LastUsed.never().millisecondsSince(makeTimestamp())).toBe(null);
  });

  it("millisecondsSince clamps negative to 0", () => {
    const earlier = makeTimestamp(ANCHOR_TIME_MS);
    const later = makeTimestamp(ANCHOR_TIME_MS + 100);
    expect(LastUsed.at(later).millisecondsSince(earlier)).toBe(0);
  });

  it("millisecondsSince returns positive delta", () => {
    expect(
      LastUsed.at(makeTimestamp(ANCHOR_TIME_MS)).millisecondsSince(
        makeTimestamp(ANCHOR_TIME_MS + 1000),
      ),
    ).toBe(1000);
  });

  it("equals", () => {
    expect(LastUsed.never().equals(LastUsed.never())).toBe(true);
    expect(
      LastUsed.at(makeTimestamp()).equals(LastUsed.at(makeTimestamp())),
    ).toBe(true);
    expect(
      LastUsed.never().equals(LastUsed.at(makeTimestamp())),
    ).toBe(false);
    expect(
      LastUsed.at(makeTimestamp(ANCHOR_TIME_MS)).equals(
        LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 1)),
      ),
    ).toBe(false);
  });
});

describe("SupersededBy", () => {
  it("of / fromRaw", () => {
    const id = DecisionId.from(FIXED_DECISION_UUID);
    const s = SupersededBy.of(id);
    expect(s.decisionId.equals(id)).toBe(true);
    expect(SupersededBy.fromRaw(FIXED_DECISION_UUID).decisionId.toString())
      .toBe(FIXED_DECISION_UUID);
  });

  it("equals", () => {
    expect(
      SupersededBy.fromRaw(FIXED_DECISION_UUID).equals(
        SupersededBy.fromRaw(FIXED_DECISION_UUID),
      ),
    ).toBe(true);
  });
});
