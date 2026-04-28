import { describe, expect, it } from "vitest";
import { ApplyDecayUseCase } from "../../../../src/modules/curator/application/use-cases/apply-decay.use-case.ts";
import type {
  EntityLocationProjection,
  MemoryEntryProjection,
  MemoryEntryReader,
} from "../../../../src/modules/curator/application/ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../../../../src/modules/curator/application/ports/out/memory-entry-writer.port.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  FIXED_TASK_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubReader implements MemoryEntryReader {
  public readonly entries: Map<string, MemoryEntryProjection[]> = new Map();

  public listActiveByKind(input: {
    kind: MemoryEntryKind;
  }): Promise<readonly MemoryEntryProjection[]> {
    return Promise.resolve(this.entries.get(input.kind.toString()) ?? []);
  }

  public listPruneCandidates(): Promise<readonly MemoryEntryProjection[]> {
    return Promise.resolve([]);
  }

  public listEntityLocations(): Promise<readonly EntityLocationProjection[]> {
    return Promise.resolve([]);
  }
}

class RecordingWriter implements MemoryEntryWriter {
  public readonly applyCalls: Array<{
    kind: string;
    entryId: string;
    newConfidence: number;
  }> = [];
  public readonly batchCalls: Array<number> = [];

  public applyDecay(input: {
    kind: MemoryEntryKind;
    entryId: string;
    newConfidence: Confidence;
  }): Promise<boolean> {
    this.applyCalls.push({
      kind: input.kind.toString(),
      entryId: input.entryId,
      newConfidence: input.newConfidence.toNumber(),
    });
    return Promise.resolve(true);
  }

  public applyDecayBatch(input: {
    items: readonly {
      readonly kind: MemoryEntryKind;
      readonly entryId: string;
      readonly newConfidence: Confidence;
    }[];
  }): Promise<number> {
    this.batchCalls.push(input.items.length);
    for (const item of input.items) {
      this.applyCalls.push({
        kind: item.kind.toString(),
        entryId: item.entryId,
        newConfidence: item.newConfidence.toNumber(),
      });
    }
    return Promise.resolve(input.items.length);
  }

  public tagEntityAsStale(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public markPruned(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

function makeProjection(
  kind: MemoryEntryKind,
  id: string,
  ageDays: number,
  options: {
    confidence?: number;
    severity?: LearningSeverity | null;
  } = {},
): MemoryEntryProjection {
  const now = ANCHOR_TIME_MS;
  return {
    workspaceId: makeWorkspaceId(),
    kind,
    id,
    confidence: Confidence.of(options.confidence ?? 1),
    lastUsedMs: now - ageDays * 24 * 60 * 60 * 1000,
    useCount: 0,
    createdAt: makeTimestamp(now - ageDays * 24 * 60 * 60 * 1000),
    severity: options.severity ?? null,
    tags: [],
    contentSnapshot: "{}",
  };
}

describe("ApplyDecayUseCase", () => {
  it("decays entries past their last-used window", async () => {
    const reader = new StubReader();
    reader.entries.set("decision", [
      makeProjection(MemoryEntryKind.decision(), FIXED_DECISION_UUID, 100),
    ]);
    reader.entries.set("learning", [
      makeProjection(MemoryEntryKind.learning(), FIXED_LEARNING_UUID, 30, {
        severity: LearningSeverity.tip(),
      }),
    ]);
    const writer = new RecordingWriter();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const useCase = new ApplyDecayUseCase(reader, writer, clock, new SilentLogger());
    const result = await useCase.apply({
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      workspaceId: makeWorkspaceId(),
    });
    expect(result.entriesScanned).toBe(2);
    expect(result.entriesDecayed).toBe(2);
    expect(writer.applyCalls.length).toBe(2);
    // Decision: 0.999888^100 ≈ 0.9888
    const decisionCall = writer.applyCalls.find(
      (c) => c.kind === "decision",
    );
    expect(decisionCall?.newConfidence).toBeLessThan(1);
    expect(decisionCall?.newConfidence).toBeGreaterThan(0.95);
  });

  it("skips entries with unity factor (task)", async () => {
    const reader = new StubReader();
    reader.entries.set("task", [
      makeProjection(MemoryEntryKind.task(), FIXED_TASK_UUID, 100),
    ]);
    const writer = new RecordingWriter();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const useCase = new ApplyDecayUseCase(
      reader,
      writer,
      clock,
      new SilentLogger(),
    );
    const result = await useCase.apply({
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      workspaceId: makeWorkspaceId(),
    });
    expect(result.entriesScanned).toBe(1);
    expect(result.entriesDecayed).toBe(0);
    expect(writer.applyCalls.length).toBe(0);
  });

  it("does not call writer when confidence does not change (zero days)", async () => {
    const reader = new StubReader();
    reader.entries.set("decision", [
      makeProjection(MemoryEntryKind.decision(), FIXED_DECISION_UUID, 0),
    ]);
    const writer = new RecordingWriter();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const useCase = new ApplyDecayUseCase(
      reader,
      writer,
      clock,
      new SilentLogger(),
    );
    const result = await useCase.apply({
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      workspaceId: makeWorkspaceId(),
    });
    expect(result.entriesScanned).toBe(1);
    expect(result.entriesDecayed).toBe(0);
  });

  it("treats negative elapsed (clock skew) as zero days", async () => {
    const reader = new StubReader();
    const future = makeProjection(
      MemoryEntryKind.decision(),
      FIXED_DECISION_UUID,
      -1, // future timestamp
    );
    reader.entries.set("decision", [future]);
    const writer = new RecordingWriter();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const useCase = new ApplyDecayUseCase(
      reader,
      writer,
      clock,
      new SilentLogger(),
    );
    const result = await useCase.apply({
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      workspaceId: makeWorkspaceId(),
    });
    expect(result.entriesScanned).toBe(1);
    expect(result.entriesDecayed).toBe(0);
  });

  it("returns zero counters when there are no entries", async () => {
    const reader = new StubReader();
    const writer = new RecordingWriter();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const useCase = new ApplyDecayUseCase(
      reader,
      writer,
      clock,
      new SilentLogger(),
    );
    const result = await useCase.apply({
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      workspaceId: makeWorkspaceId(),
    });
    expect(result.entriesScanned).toBe(0);
    expect(result.entriesDecayed).toBe(0);
  });
});
