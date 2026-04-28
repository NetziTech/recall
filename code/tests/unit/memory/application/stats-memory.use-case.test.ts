import { describe, expect, it } from "vitest";
import { StatsMemoryUseCase } from "../../../../src/modules/memory/application/use-cases/stats-memory.use-case.ts";
import type {
  MemoryStatsReader,
  MemoryStatsSnapshot,
} from "../../../../src/modules/memory/application/ports/out/memory-stats-reader.port.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const ZERO_COUNTS = {
  decisions: 0,
  activeDecisions: 0,
  learnings: 0,
  activeLearnings: 0,
  entities: 0,
  tasks: 0,
  openTasks: 0,
  turns: 0,
  sessions: 0,
  activeSessions: 0,
  relations: 0,
};

class StubReader implements MemoryStatsReader {
  public lastWs: WorkspaceId | null = null;
  public constructor(private readonly snap: MemoryStatsSnapshot) {}
  public read(input: { workspaceId: WorkspaceId }): Promise<MemoryStatsSnapshot> {
    this.lastWs = input.workspaceId;
    return Promise.resolve(this.snap);
  }
}

describe("StatsMemoryUseCase.stats", () => {
  it("forwards counts and bounds from the reader", async () => {
    const snap: MemoryStatsSnapshot = {
      counts: { ...ZERO_COUNTS, decisions: 5, learnings: 3 },
      oldestEntryMs: 1_000,
      newestEntryMs: 9_000,
    };
    const reader = new StubReader(snap);
    const useCase = new StatsMemoryUseCase(reader, new SilentLogger());
    const ws = makeWorkspaceId();
    const result = await useCase.stats({ workspaceId: ws });
    expect(result.workspaceId).toBe(ws);
    expect(result.counts.decisions).toBe(5);
    expect(result.counts.learnings).toBe(3);
    expect(result.oldestEntryMs).toBe(1_000);
    expect(result.newestEntryMs).toBe(9_000);
    expect(reader.lastWs).toBe(ws);
  });

  it("propagates null bounds for empty workspace", async () => {
    const reader = new StubReader({
      counts: ZERO_COUNTS,
      oldestEntryMs: null,
      newestEntryMs: null,
    });
    const useCase = new StatsMemoryUseCase(reader, new SilentLogger());
    const result = await useCase.stats({ workspaceId: makeWorkspaceId() });
    expect(result.oldestEntryMs).toBe(null);
    expect(result.newestEntryMs).toBe(null);
  });
});
