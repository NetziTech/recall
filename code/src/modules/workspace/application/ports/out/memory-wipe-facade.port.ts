import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driven (output) facade port toward the `memory` module's
 * `WipeMemory` use case.
 *
 * Used by `DestroyWorkspaceUseCase` to truncate the SQL tables
 * BEFORE the workspace filesystem adapter removes the
 * `.recall/` directory.
 *
 * Why the workspace module talks to memory through a facade:
 *   - Cross-module imports of code are forbidden by ADR-001 (`docs/12
 *     §1.5.1`). The composition root wires this facade against the
 *     concrete `WipeMemoryUseCase` in
 *     `composition/facades/workspace-memory-facades.ts`.
 *   - The facade keeps the workspace use case independent of the
 *     memory module's wiring: a future change in how `WipeMemory`
 *     dispatches (e.g. adding telemetry hooks) does not ripple here.
 */
export interface MemoryWipeFacadeOutcome {
  /** Total number of memory rows truncated. */
  readonly rowsDeleted: number;
}

export interface MemoryWipeFacade {
  wipe(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<MemoryWipeFacadeOutcome>;
}
