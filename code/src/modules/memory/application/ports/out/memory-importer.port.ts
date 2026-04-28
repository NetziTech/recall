import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

import type { MemorySnapshot } from "./memory-exporter.port.ts";

/**
 * Driven (output) port: parse a JSON document produced by
 * `MemoryExporter.serialise(...)` back into a `MemorySnapshot`.
 *
 * The importer is responsible for:
 * 1. Validating the envelope shape (Zod).
 * 2. Building each aggregate via its `rehydrate(...)` factory.
 * 3. Re-pinning the `workspaceId` of every aggregate to the target
 *    workspace (the source export carries its OWN workspace id; the
 *    importer rewires every row to the destination so the import is
 *    safe across workspaces).
 *
 * Failures surface as
 * `MemoryInfrastructureError.importParseFailed(...)`.
 */
export interface MemoryImporter {
  parse(input: { json: string; workspaceId: WorkspaceId }): MemorySnapshot;
}
