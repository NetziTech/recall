import { describe, expect, it } from "vitest";
import { ImportHandoffUseCase } from "../../../../src/modules/memory/application/use-cases/import-handoff.use-case.ts";
import type {
  HandoffParser,
  ParsedHandoff,
} from "../../../../src/modules/memory/application/ports/out/handoff-parser.port.ts";
import type { DecisionRepository } from "../../../../src/modules/memory/domain/repositories/decision-repository.ts";
import type { LearningRepository } from "../../../../src/modules/memory/domain/repositories/learning-repository.ts";
import type { TaskRepository } from "../../../../src/modules/memory/domain/repositories/task-repository.ts";
import type { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import type { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import type { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import type { DatabaseConnection } from "../../../../src/shared/application/ports/database-connection.port.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import {
  ANCHOR_TIME_MS,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class FakeDb implements DatabaseConnection {
  public prepare(): never {
    throw new Error("not used");
  }
  public exec(): void {}
  public transaction<T>(fn: () => T): T {
    return fn();
  }
  public close(): void {}
}

class StubParser implements HandoffParser {
  public constructor(private readonly out: ParsedHandoff) {}
  public parse(): ParsedHandoff {
    return this.out;
  }
}

class RecDecisionRepo implements DecisionRepository {
  public readonly saved: Decision[] = [];
  public findById(): Promise<null> {
    return Promise.resolve(null);
  }
  public save(d: Decision): Promise<void> {
    this.saved.push(d);
    return Promise.resolve();
  }
  public findByWorkspace(): Promise<readonly Decision[]> {
    return Promise.resolve([]);
  }
  public findActiveByTags(): Promise<readonly Decision[]> {
    return Promise.resolve([]);
  }
}

class RecLearningRepo implements LearningRepository {
  public readonly saved: Learning[] = [];
  public findById(): Promise<null> {
    return Promise.resolve(null);
  }
  public save(l: Learning): Promise<void> {
    this.saved.push(l);
    return Promise.resolve();
  }
  public findByWorkspace(): Promise<readonly Learning[]> {
    return Promise.resolve([]);
  }
  public findActiveByMinimumSeverity(): Promise<readonly Learning[]> {
    return Promise.resolve([]);
  }
}

class RecTaskRepo implements TaskRepository {
  public readonly saved: Task[] = [];
  public findById(): Promise<null> {
    return Promise.resolve(null);
  }
  public save(t: Task): Promise<void> {
    this.saved.push(t);
    return Promise.resolve();
  }
  public delete(): Promise<boolean> {
    return Promise.resolve(false);
  }
  public findOpenByWorkspace(): Promise<readonly Task[]> {
    return Promise.resolve([]);
  }
  public findByStatus(): Promise<readonly Task[]> {
    return Promise.resolve([]);
  }
  public findByPriority(): Promise<readonly Task[]> {
    return Promise.resolve([]);
  }
}

function makeUseCase(parsed: ParsedHandoff): {
  useCase: ImportHandoffUseCase;
  decisions: RecDecisionRepo;
  learnings: RecLearningRepo;
  tasks: RecTaskRepo;
} {
  const decisions = new RecDecisionRepo();
  const learnings = new RecLearningRepo();
  const tasks = new RecTaskRepo();
  const useCase = new ImportHandoffUseCase(
    new FakeDb(),
    new StubParser(parsed),
    decisions,
    learnings,
    tasks,
    new FakeIdGenerator({ seed: 1 }),
    new FakeClock({ initialMs: ANCHOR_TIME_MS }),
    new SilentLogger(),
  );
  return { useCase, decisions, learnings, tasks };
}

describe("ImportHandoffUseCase.import", () => {
  it("persists decisions, learnings and tasks; reports counts", async () => {
    const parsed: ParsedHandoff = {
      decisions: [
        {
          title: "Adopt SQLCipher",
          rationale: "encryption at rest",
          tags: Tags.create(["handoff-import"]),
          confidence: 0.9,
        },
      ],
      learnings: [
        {
          text: "trim paths before compare",
          severity: "tip",
          tags: Tags.create(["handoff-import"]),
        },
      ],
      tasks: [
        {
          title: "Wire embeddings",
          description: null,
          priority: "medium",
          tags: Tags.create(["handoff-import"]),
        },
      ],
      skipped: [],
    };
    const { useCase, decisions, learnings, tasks } = makeUseCase(parsed);
    const result = await useCase.import({
      workspaceId: makeWorkspaceId(),
      markdown: "# header",
    });
    expect(result.counts.decisions).toBe(1);
    expect(result.counts.learnings).toBe(1);
    expect(result.counts.tasks).toBe(1);
    expect(decisions.saved.length).toBe(1);
    expect(learnings.saved.length).toBe(1);
    expect(tasks.saved.length).toBe(1);
    expect(result.skipped.length).toBe(0);
    expect(result.importedAtMs).toBe(ANCHOR_TIME_MS);
  });

  it("treats whitespace-only task description as null", async () => {
    const parsed: ParsedHandoff = {
      decisions: [],
      learnings: [],
      tasks: [
        {
          title: "T",
          description: "   ",
          priority: "low",
          tags: Tags.create(["handoff-import"]),
        },
      ],
      skipped: [],
    };
    const { useCase, tasks } = makeUseCase(parsed);
    await useCase.import({
      workspaceId: makeWorkspaceId(),
      markdown: "",
    });
    expect(tasks.saved[0]?.getDescription()).toBe(null);
  });

  it("propagates skipped lines from parser", async () => {
    const parsed: ParsedHandoff = {
      decisions: [],
      learnings: [],
      tasks: [],
      skipped: ["L42: weird line"],
    };
    const { useCase } = makeUseCase(parsed);
    const result = await useCase.import({
      workspaceId: makeWorkspaceId(),
      markdown: "",
    });
    expect(result.skipped).toEqual(["L42: weird line"]);
    expect(result.counts.decisions).toBe(0);
  });

  it("aggregates do not leak unprocessed events", async () => {
    const parsed: ParsedHandoff = {
      decisions: [
        {
          title: "T",
          rationale: "R",
          tags: Tags.create(["handoff-import"]),
          confidence: 1,
        },
      ],
      learnings: [],
      tasks: [],
      skipped: [],
    };
    const { useCase, decisions } = makeUseCase(parsed);
    await useCase.import({
      workspaceId: makeWorkspaceId(),
      markdown: "",
    });
    // pullEvents called inside use case → no events left to pull again.
    expect(decisions.saved[0]?.pullEvents().length).toBe(0);
  });
});
