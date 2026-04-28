import { describe, expect, it } from "vitest";
import { ExportMemoryUseCase } from "../../../../src/modules/memory/application/use-cases/export-memory.use-case.ts";
import type { MemorySnapshotReader } from "../../../../src/modules/memory/application/ports/out/memory-snapshot-reader.port.ts";
import type {
  MemoryExporter,
  MemorySnapshot,
} from "../../../../src/modules/memory/application/ports/out/memory-exporter.port.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const EMPTY_SNAPSHOT: MemorySnapshot = {
  decisions: [],
  learnings: [],
  entities: [],
  tasks: [],
  turns: [],
  sessions: [],
  relations: [],
};

class StubReader implements MemorySnapshotReader {
  public lastWorkspace: WorkspaceId | null = null;
  public constructor(private readonly snapshot: MemorySnapshot = EMPTY_SNAPSHOT) {}
  public read(input: {
    workspaceId: WorkspaceId;
  }): Promise<MemorySnapshot> {
    this.lastWorkspace = input.workspaceId;
    return Promise.resolve(this.snapshot);
  }
}

class StubExporter implements MemoryExporter {
  public lastSnapshot: MemorySnapshot | null = null;
  public constructor(private readonly out: string = '{"schemaVersion":1}') {}
  public serialise(snapshot: MemorySnapshot): string {
    this.lastSnapshot = snapshot;
    return this.out;
  }
}

describe("ExportMemoryUseCase.export", () => {
  it("threads the workspace through reader and exporter", async () => {
    const reader = new StubReader();
    const exporter = new StubExporter('{"k":"v"}');
    const useCase = new ExportMemoryUseCase(
      reader,
      exporter,
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const ws = makeWorkspaceId();
    const result = await useCase.export({ workspaceId: ws });
    expect(result.workspaceId).toBe(ws);
    expect(result.json).toBe('{"k":"v"}');
    expect(result.exportedAtMs).toBe(ANCHOR_TIME_MS);
    expect(result.schemaVersion).toBe(1);
    expect(reader.lastWorkspace).toBe(ws);
    expect(exporter.lastSnapshot).toBe(EMPTY_SNAPSHOT);
  });

  it("counts derived from snapshot lengths", async () => {
    const snap: MemorySnapshot = {
      ...EMPTY_SNAPSHOT,
      decisions: [{} as never, {} as never],
      tasks: [{} as never],
    };
    const reader = new StubReader(snap);
    const exporter = new StubExporter();
    const useCase = new ExportMemoryUseCase(
      reader,
      exporter,
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.export({ workspaceId: makeWorkspaceId() });
    expect(result.counts.decisions).toBe(2);
    expect(result.counts.tasks).toBe(1);
    expect(result.counts.learnings).toBe(0);
    expect(result.counts.entities).toBe(0);
    expect(result.counts.turns).toBe(0);
    expect(result.counts.sessions).toBe(0);
    expect(result.counts.relations).toBe(0);
  });

  it("propagates exporter errors", async () => {
    class ThrowingExporter implements MemoryExporter {
      public serialise(): never {
        throw new Error("boom");
      }
    }
    const useCase = new ExportMemoryUseCase(
      new StubReader(),
      new ThrowingExporter(),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    await expect(
      useCase.export({ workspaceId: makeWorkspaceId() }),
    ).rejects.toThrow("boom");
  });
});
