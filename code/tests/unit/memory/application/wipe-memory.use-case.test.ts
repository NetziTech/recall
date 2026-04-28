import { describe, expect, it } from "vitest";
import { WipeMemoryUseCase } from "../../../../src/modules/memory/application/use-cases/wipe-memory.use-case.ts";
import type {
  MemoryWipeOutcome,
  MemoryWiper,
} from "../../../../src/modules/memory/application/ports/out/memory-wiper.port.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubWiper implements MemoryWiper {
  public lastWs: WorkspaceId | null = null;
  public throwOn = false;
  public constructor(private readonly rows: number) {}
  public wipe(input: {
    workspaceId: WorkspaceId;
  }): Promise<MemoryWipeOutcome> {
    if (this.throwOn) return Promise.reject(new Error("boom"));
    this.lastWs = input.workspaceId;
    return Promise.resolve({ rowsDeleted: this.rows });
  }
}

describe("WipeMemoryUseCase.wipe", () => {
  it("delegates to the wiper, returns rowsDeleted and timestamp", async () => {
    const wiper = new StubWiper(42);
    const useCase = new WipeMemoryUseCase(
      wiper,
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const ws = makeWorkspaceId();
    const result = await useCase.wipe({ workspaceId: ws });
    expect(result.workspaceId).toBe(ws);
    expect(result.rowsDeleted).toBe(42);
    expect(result.wipedAtMs).toBe(ANCHOR_TIME_MS);
    expect(wiper.lastWs).toBe(ws);
  });

  it("propagates wiper errors", async () => {
    const wiper = new StubWiper(0);
    wiper.throwOn = true;
    const useCase = new WipeMemoryUseCase(
      wiper,
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    await expect(useCase.wipe({ workspaceId: makeWorkspaceId() })).rejects.toThrow(
      "boom",
    );
  });
});
