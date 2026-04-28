import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

import type { MemorySnapshot } from "./memory-exporter.port.ts";

/**
 * Driven (output) port: load the entire memory of a workspace as a
 * single in-memory snapshot.
 *
 * Used by the `ExportMemory` use case. Sibling repositories
 * (`DecisionRepository.findByWorkspace`, `LearningRepository.findByWorkspace`,
 * `EntityRepository.findByWorkspace`) already cover four of the seven
 * kinds, but:
 *
 * - `TaskRepository` only exposes per-status / per-priority queries.
 * - `TurnRepository` only exposes per-session / per-id queries.
 * - `SessionRepository` only exposes "the active one" / per-id.
 * - `RelationRepository` only exposes per-endpoint queries.
 *
 * Adding `findByWorkspace` to every repository would inflate their
 * surface for one consumer. The export use case is the only consumer
 * of "every row of every kind"; encapsulating the read in a dedicated
 * port keeps the repository contracts focused.
 *
 * Implementations live in `infrastructure/persistence/`. The adapter
 * issues one prepared statement per kind and packs the rows into the
 * snapshot.
 */
export interface MemorySnapshotReader {
  read(input: { workspaceId: WorkspaceId }): Promise<MemorySnapshot>;
}
