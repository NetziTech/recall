import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  ExportMemory,
  ExportMemoryResult,
} from "../ports/in/export-memory.port.ts";
import type { MemoryExporter } from "../ports/out/memory-exporter.port.ts";
import type { MemorySnapshotReader } from "../ports/out/memory-snapshot-reader.port.ts";

/**
 * Use case: serialise the entire memory of a workspace to a JSON
 * string.
 *
 * Implements the `ExportMemory` driving port. Two collaborators do
 * the work:
 *
 * 1. `MemorySnapshotReader.read(...)` materialises every aggregate.
 * 2. `MemoryExporter.serialise(...)` renders the snapshot to a
 *    UTF-8 JSON envelope.
 *
 * The use case wires them together and assembles the per-kind counter
 * map from the snapshot lengths.
 */
export class ExportMemoryUseCase implements ExportMemory {
  public constructor(
    private readonly snapshotReader: MemorySnapshotReader,
    private readonly exporter: MemoryExporter,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async export(input: {
    workspaceId: WorkspaceId;
  }): Promise<ExportMemoryResult> {
    const exportedAt = this.clock.now();
    const snapshot = await this.snapshotReader.read({
      workspaceId: input.workspaceId,
    });
    const json = this.exporter.serialise(snapshot);
    const counts = Object.freeze({
      decisions: snapshot.decisions.length,
      learnings: snapshot.learnings.length,
      entities: snapshot.entities.length,
      tasks: snapshot.tasks.length,
      turns: snapshot.turns.length,
      sessions: snapshot.sessions.length,
      relations: snapshot.relations.length,
    });
    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        exportedAtMs: exportedAt.epochMs,
        ...counts,
        bytes: json.length,
      },
      "memory export completed",
    );
    return {
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      exportedAtMs: exportedAt.epochMs,
      json,
      counts,
    };
  }
}
