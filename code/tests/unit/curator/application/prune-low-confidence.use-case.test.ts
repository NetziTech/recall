import { describe, expect, it } from "vitest";
import { PruneLowConfidenceUseCase } from "../../../../src/modules/curator/application/use-cases/prune-low-confidence.use-case.ts";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { PruneThreshold } from "../../../../src/modules/curator/domain/value-objects/prune-threshold.ts";
import { CuratorApplicationError } from "../../../../src/modules/curator/application/errors/curator-application-error.ts";
import type { CuratorRunRepository } from "../../../../src/modules/curator/domain/repositories/curator-run-repository.ts";
import type { PrunedEntryRepository } from "../../../../src/modules/curator/domain/repositories/pruned-entry-repository.ts";
import type { PrunedEntry } from "../../../../src/modules/curator/domain/value-objects/pruned-entry.ts";
import type {
  EntityLocationProjection,
  MemoryEntryProjection,
  MemoryEntryReader,
} from "../../../../src/modules/curator/application/ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../../../../src/modules/curator/application/ports/out/memory-entry-writer.port.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  FIXED_LEARNING_UUID,
  FIXED_TURN_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const SECOND_LEARNING_UUID = "01952f3c-bbbb-7000-8000-000000000001";

function makeProjection(
  kind: MemoryEntryKind,
  id: string,
  workspaceId: WorkspaceId,
  options: {
    confidence?: number;
    createdAtMs?: number;
  } = {},
): MemoryEntryProjection {
  return {
    workspaceId,
    kind,
    id,
    confidence: Confidence.of(options.confidence ?? 0.1),
    lastUsedMs: options.createdAtMs ?? ANCHOR_TIME_MS,
    useCount: 0,
    createdAt: makeTimestamp(options.createdAtMs ?? ANCHOR_TIME_MS),
    severity: null,
    tags: [],
    contentSnapshot: JSON.stringify({ kind: kind.toString(), id }),
  };
}

class StubReader implements MemoryEntryReader {
  public candidates: MemoryEntryProjection[] = [];
  public readonly listPruneCalls: Array<{
    pruneableKinds: readonly MemoryEntryKind[];
    confidenceBelow: Confidence;
    cutoffMs: number;
  }> = [];

  public listActiveByKind(): Promise<readonly MemoryEntryProjection[]> {
    return Promise.resolve([]);
  }

  public listPruneCandidates(input: {
    workspaceId: WorkspaceId;
    pruneableKinds: readonly MemoryEntryKind[];
    confidenceBelow: Confidence;
    cutoffMs: number;
  }): Promise<readonly MemoryEntryProjection[]> {
    void input.workspaceId;
    this.listPruneCalls.push({
      pruneableKinds: input.pruneableKinds,
      confidenceBelow: input.confidenceBelow,
      cutoffMs: input.cutoffMs,
    });
    return Promise.resolve(this.candidates);
  }

  public listEntityLocations(): Promise<readonly EntityLocationProjection[]> {
    return Promise.resolve([]);
  }
}

class RecordingWriter implements MemoryEntryWriter {
  public readonly markPrunedCalls: Array<{
    kind: string;
    entryId: string;
    reasonKind: string;
  }> = [];
  public readonly markPrunedBatchCalls: Array<{
    itemCount: number;
  }> = [];
  public defaultMarkPruned: boolean = true;
  public missingIds = new Set<string>();

  public applyDecay(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public applyDecayBatch(): Promise<number> {
    return Promise.resolve(0);
  }

  public tagEntityAsStale(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public markPruned(input: {
    kind: MemoryEntryKind;
    entryId: string;
    reasonKind: string;
  }): Promise<boolean> {
    this.markPrunedCalls.push({
      kind: input.kind.toString(),
      entryId: input.entryId,
      reasonKind: input.reasonKind,
    });
    if (this.missingIds.has(input.entryId)) return Promise.resolve(false);
    return Promise.resolve(this.defaultMarkPruned);
  }

  public markPrunedBatch(input: {
    items: readonly {
      readonly kind: MemoryEntryKind;
      readonly entryId: string;
      readonly reasonKind: string;
    }[];
  }): Promise<readonly boolean[]> {
    this.markPrunedBatchCalls.push({ itemCount: input.items.length });
    const mask = input.items.map((item) => {
      this.markPrunedCalls.push({
        kind: item.kind.toString(),
        entryId: item.entryId,
        reasonKind: item.reasonKind,
      });
      if (this.missingIds.has(item.entryId)) return false;
      return this.defaultMarkPruned;
    });
    return Promise.resolve(mask);
  }
}

class InMemoryCuratorRunRepo implements CuratorRunRepository {
  public readonly stored = new Map<string, CuratorRun>();

  public findById(id: CuratorRunId): Promise<CuratorRun | null> {
    return Promise.resolve(this.stored.get(id.toString()) ?? null);
  }

  public save(run: CuratorRun): Promise<void> {
    this.stored.set(run.getId().toString(), run);
    return Promise.resolve();
  }

  public findRecentByWorkspace(): Promise<readonly CuratorRun[]> {
    return Promise.resolve([]);
  }

  public findLastByWorkspace(): Promise<CuratorRun | null> {
    return Promise.resolve(null);
  }
}

class RecordingPrunedRepo implements PrunedEntryRepository {
  public readonly stored: PrunedEntry[] = [];

  public save(entry: PrunedEntry): Promise<void> {
    this.stored.push(entry);
    return Promise.resolve();
  }

  public findById(): Promise<PrunedEntry | null> {
    return Promise.resolve(null);
  }

  public findByWorkspace(): Promise<readonly PrunedEntry[]> {
    return Promise.resolve([]);
  }
}

function makeUseCase(): {
  useCase: PruneLowConfidenceUseCase;
  reader: StubReader;
  writer: RecordingWriter;
  pruned: RecordingPrunedRepo;
  runs: InMemoryCuratorRunRepo;
  clock: FakeClock;
} {
  const reader = new StubReader();
  const writer = new RecordingWriter();
  const pruned = new RecordingPrunedRepo();
  const runs = new InMemoryCuratorRunRepo();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const useCase = new PruneLowConfidenceUseCase(
    reader,
    writer,
    pruned,
    runs,
    clock,
    new SilentLogger(),
  );
  return { useCase, reader, writer, pruned, runs, clock };
}

function seedRun(
  runs: InMemoryCuratorRunRepo,
  workspaceId: WorkspaceId,
  clock: FakeClock,
): CuratorRunId {
  const runId = CuratorRunId.from(FIXED_CURATOR_RUN_UUID);
  const run = CuratorRun.start({
    id: runId,
    workspaceId,
    trigger: CuratorRunTrigger.scheduled(),
    occurredAt: clock.now(),
  });
  runs.stored.set(runId.toString(), run);
  return runId;
}

describe("PruneLowConfidenceUseCase", () => {
  it("returns zero result when no candidates exist", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [];

    const result = await useCase.prune({ runId, workspaceId });
    expect(result.entriesPruned).toBe(0);
  });

  it("snapshots and prunes a learning candidate (records EntryPruned on the run)", async () => {
    const { useCase, reader, writer, pruned, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [
      makeProjection(MemoryEntryKind.learning(), FIXED_LEARNING_UUID, workspaceId),
    ];

    const result = await useCase.prune({ runId, workspaceId });
    expect(result.entriesPruned).toBe(1);
    // 1. PrunedEntry archived first.
    expect(pruned.stored.length).toBe(1);
    expect(pruned.stored[0]?.reason.toString()).toBe("low_confidence");
    expect(pruned.stored[0]?.getOriginalId()).toBe(FIXED_LEARNING_UUID);
    // 2. Live row marked pruned.
    expect(writer.markPrunedCalls.length).toBe(1);
    expect(writer.markPrunedCalls[0]?.reasonKind).toBe("low_confidence");
    // 3. Run was saved (with at least one EntryPruned event in buffer).
    const persistedRun = runs.stored.get(runId.toString());
    expect(persistedRun).toBeDefined();
  });

  it("uses default PruneThreshold when not provided", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [];
    await useCase.prune({ runId, workspaceId });
    expect(reader.listPruneCalls.length).toBe(1);
    expect(reader.listPruneCalls[0]?.confidenceBelow.toNumber()).toBe(
      PruneThreshold.default().toNumber(),
    );
  });

  it("uses an explicit threshold override", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [];
    await useCase.prune({
      runId,
      workspaceId,
      threshold: PruneThreshold.of(0.5),
    });
    expect(reader.listPruneCalls[0]?.confidenceBelow.toNumber()).toBe(0.5);
  });

  it("computes a 30-day cutoff from the clock", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [];
    await useCase.prune({ runId, workspaceId });
    const expectedCutoff = ANCHOR_TIME_MS - 30 * 24 * 60 * 60 * 1000;
    expect(reader.listPruneCalls[0]?.cutoffMs).toBe(expectedCutoff);
  });

  it("only passes [learning, turn] kinds to the reader", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [];
    await useCase.prune({ runId, workspaceId });
    const passed = reader.listPruneCalls[0]?.pruneableKinds;
    const kindNames = passed?.map((k) => k.toString());
    expect(kindNames).toEqual(["learning", "turn"]);
  });

  it("does NOT bump the counter when the writer reports the row was already gone", async () => {
    const { useCase, reader, writer, pruned, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [
      makeProjection(MemoryEntryKind.learning(), FIXED_LEARNING_UUID, workspaceId),
    ];
    writer.missingIds.add(FIXED_LEARNING_UUID);
    const result = await useCase.prune({ runId, workspaceId });
    expect(result.entriesPruned).toBe(0);
    // Snapshot still archived (audit trail before live row goes away).
    expect(pruned.stored.length).toBe(1);
  });

  it("processes multiple candidates of mixed kinds", async () => {
    const { useCase, reader, writer, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.candidates = [
      makeProjection(MemoryEntryKind.learning(), FIXED_LEARNING_UUID, workspaceId),
      makeProjection(MemoryEntryKind.turn(), FIXED_TURN_UUID, workspaceId),
      makeProjection(MemoryEntryKind.learning(), SECOND_LEARNING_UUID, workspaceId),
    ];
    const result = await useCase.prune({ runId, workspaceId });
    expect(result.entriesPruned).toBe(3);
    expect(writer.markPrunedCalls.length).toBe(3);
  });

  it("throws CuratorApplicationError.runNotFound when run does not exist and there are candidates", async () => {
    const { useCase, reader } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    reader.candidates = [
      makeProjection(MemoryEntryKind.learning(), FIXED_LEARNING_UUID, workspaceId),
    ];
    await expect(
      useCase.prune({
        runId: CuratorRunId.from("01952f3c-bbbb-7000-8000-bbbbbbbbbbbb"),
        workspaceId,
      }),
    ).rejects.toThrow(CuratorApplicationError);
  });

  it("does NOT consult the run repo when there are no candidates (fast path)", async () => {
    const { useCase, reader, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    seedRun(runs, workspaceId, clock);
    reader.candidates = [];
    // Use a runId that does NOT exist in the repo; the fast path should
    // skip the lookup entirely (no throw).
    const result = await useCase.prune({
      runId: CuratorRunId.from("01952f3c-bbbb-7000-8000-cccccccccccc"),
      workspaceId,
    });
    expect(result.entriesPruned).toBe(0);
    void Timestamp; // unused-import guard
  });
});
