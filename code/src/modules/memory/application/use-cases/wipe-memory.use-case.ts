import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  WipeMemory,
  WipeMemoryResult,
} from "../ports/in/wipe-memory.port.ts";
import type { MemoryWiper } from "../ports/out/memory-wiper.port.ts";

/**
 * Use case: erase every memory row in the workspace.
 *
 * Implements the `WipeMemory` driving port. Thin wrapper around the
 * `MemoryWiper` driven port: the destructive transaction lives in
 * the adapter.
 *
 * The use case logs at `warn` level (not `info`) because a wipe is
 * an irreversible operation that the operator should be able to
 * audit after the fact. The CLI's parser is responsible for the
 * `WIPE` literal confirmation; this use case does NOT re-validate.
 */
export class WipeMemoryUseCase implements WipeMemory {
  public constructor(
    private readonly wiper: MemoryWiper,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async wipe(input: {
    workspaceId: WorkspaceId;
  }): Promise<WipeMemoryResult> {
    const wipedAt = this.clock.now();
    const outcome = await this.wiper.wipe({ workspaceId: input.workspaceId });
    this.logger.warn(
      {
        workspaceId: input.workspaceId.toString(),
        rowsDeleted: outcome.rowsDeleted,
        wipedAtMs: wipedAt.epochMs,
      },
      "memory wipe completed",
    );
    return {
      workspaceId: input.workspaceId,
      wipedAtMs: wipedAt.epochMs,
      rowsDeleted: outcome.rowsDeleted,
    };
  }
}
