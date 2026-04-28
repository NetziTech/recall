import { describe, expect, it } from "vitest";
import { SelfHealUseCase } from "../../../../src/modules/curator/application/use-cases/self-heal.use-case.ts";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { PathStaleness } from "../../../../src/modules/curator/domain/value-objects/path-staleness.ts";
import { CuratorApplicationError } from "../../../../src/modules/curator/application/errors/curator-application-error.ts";
import type { CuratorRunRepository } from "../../../../src/modules/curator/domain/repositories/curator-run-repository.ts";
import type {
  EntityLocationProjection,
  MemoryEntryProjection,
  MemoryEntryReader,
} from "../../../../src/modules/curator/application/ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../../../../src/modules/curator/application/ports/out/memory-entry-writer.port.ts";
import type { FilesystemChecker } from "../../../../src/modules/curator/application/ports/out/filesystem-checker.port.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  FIXED_ENTITY_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubReader implements MemoryEntryReader {
  public locations: EntityLocationProjection[] = [];

  public listActiveByKind(): Promise<readonly MemoryEntryProjection[]> {
    return Promise.resolve([]);
  }

  public listPruneCandidates(): Promise<readonly MemoryEntryProjection[]> {
    return Promise.resolve([]);
  }

  public listEntityLocations(): Promise<readonly EntityLocationProjection[]> {
    return Promise.resolve(this.locations);
  }
}

class RecordingWriter implements MemoryEntryWriter {
  public readonly tagCalls: string[] = [];
  public defaultTagged = true;

  public applyDecay(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public applyDecayBatch(): Promise<number> {
    return Promise.resolve(0);
  }

  public tagEntityAsStale(input: { entityId: string }): Promise<boolean> {
    this.tagCalls.push(input.entityId);
    return Promise.resolve(this.defaultTagged);
  }

  public markPruned(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class FakeFilesystemChecker implements FilesystemChecker {
  public checks: PathStaleness[] = [];
  public lastInputs: readonly string[] | null = null;

  public checkPaths(
    paths: readonly string[],
  ): Promise<readonly PathStaleness[]> {
    this.lastInputs = paths;
    return Promise.resolve(this.checks);
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

function makeUseCase(): {
  useCase: SelfHealUseCase;
  reader: StubReader;
  writer: RecordingWriter;
  fs: FakeFilesystemChecker;
  runs: InMemoryCuratorRunRepo;
  clock: FakeClock;
} {
  const reader = new StubReader();
  const writer = new RecordingWriter();
  const fs = new FakeFilesystemChecker();
  const runs = new InMemoryCuratorRunRepo();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const useCase = new SelfHealUseCase(
    reader,
    writer,
    fs,
    runs,
    clock,
    new SilentLogger(),
  );
  return { useCase, reader, writer, fs, runs, clock };
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

describe("SelfHealUseCase", () => {
  it("throws CuratorApplicationError.runNotFound when run is missing", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.heal({
        runId: CuratorRunId.from("01952f3c-dddd-7000-8000-aaaaaaaaaaaa"),
        workspaceId: makeWorkspaceId(),
      }),
    ).rejects.toThrow(CuratorApplicationError);
  });

  it("returns zero counters and skips work when there are no entity locations", async () => {
    const { useCase, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(0);
    expect(result.decisionConflictsDetected).toBe(0);
    expect(result.embeddingsRequeued).toBe(0);
    expect(result.openQuestionsAged).toBe(0);
    expect(result.findingsRecorded).toBe(0);
  });

  it("Caso 1: tags entities whose path is missing as stale and records findings", async () => {
    const { useCase, reader, writer, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "src/legacy.ts",
      },
    ];
    fs.checks = [PathStaleness.missing("src/legacy.ts")];
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(1);
    expect(result.findingsRecorded).toBe(1);
    expect(writer.tagCalls).toEqual([FIXED_ENTITY_UUID]);
    // Run was saved (>=1 finding).
    expect(runs.stored.get(runId.toString())?.getFindings().length).toBe(1);
  });

  it("Caso 1: surface 'unresolvable' as a finding (requiresAttention === true)", async () => {
    const { useCase, reader, writer, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "../escapes-workspace.ts",
      },
    ];
    fs.checks = [PathStaleness.unresolvable("../escapes-workspace.ts")];
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(1);
    expect(writer.tagCalls.length).toBe(1);
  });

  it("Caso 1: skips entities whose path is present", async () => {
    const { useCase, reader, writer, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "src/exists.ts",
      },
    ];
    fs.checks = [PathStaleness.present("src/exists.ts")];
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(0);
    expect(writer.tagCalls.length).toBe(0);
  });

  it("Caso 1: strips :line suffix before probing the filesystem", async () => {
    const { useCase, reader, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "src/file.ts:42",
      },
    ];
    fs.checks = [PathStaleness.present("src/file.ts")];
    await useCase.heal({ runId, workspaceId });
    expect(fs.lastInputs).toEqual(["src/file.ts"]);
  });

  it("Caso 1: aborts safely when filesystem returns a mismatched count", async () => {
    const { useCase, reader, writer, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "a.ts",
      },
      {
        workspaceId,
        entityId: "01952f3c-dddd-7000-8000-eeeeeeeeeeee",
        location: "b.ts",
      },
    ];
    fs.checks = [PathStaleness.missing("a.ts")]; // mismatched count
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(0);
    expect(writer.tagCalls.length).toBe(0);
  });

  it("Caso 1: does NOT bump counter when writer reports no-op (already tagged)", async () => {
    const { useCase, reader, writer, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "src/legacy.ts",
      },
    ];
    fs.checks = [PathStaleness.missing("src/legacy.ts")];
    writer.defaultTagged = false;
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.pathsCorrected).toBe(0);
    expect(writer.tagCalls.length).toBe(1);
  });

  it("Casos 2/3/5 placeholders: counters stay at zero in the MVP", async () => {
    const { useCase, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    const result = await useCase.heal({ runId, workspaceId });
    expect(result.decisionConflictsDetected).toBe(0);
    expect(result.embeddingsRequeued).toBe(0);
    expect(result.openQuestionsAged).toBe(0);
  });

  it("preserves Windows drive letter when stripping :line suffix", async () => {
    const { useCase, reader, fs, runs, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    reader.locations = [
      {
        workspaceId,
        entityId: FIXED_ENTITY_UUID,
        location: "C:\\src\\file.ts:42",
      },
    ];
    fs.checks = [PathStaleness.present("C:\\src\\file.ts")];
    await useCase.heal({ runId, workspaceId });
    expect(fs.lastInputs).toEqual(["C:\\src\\file.ts"]);
  });
});
