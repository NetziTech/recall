/**
 * Cross-module facade adapters that wrap the memory module's use
 * cases in the workspace module's driving ports.
 *
 * Why composition is the home for these adapters:
 *   - The workspace module declares the facade ports
 *     (`out/memory-wipe-facade.port.ts`) precisely because it cannot
 *     import from the memory module (ADR-001 in `docs/12 §1.5.1`).
 *     Wiring both sides is the composition root's job.
 *   - Symmetric to `workspace-encryption-facades.ts`, which adapts
 *     the encryption module's use cases into the workspace's
 *     `*EncryptionFacade` ports.
 *
 * Currently exposes:
 *   - `MemoryWipeFacadeAdapter` — adapter for the workspace's
 *     `DestroyWorkspaceUseCase` flow (`mcp-memoria wipe`).
 */

import type { WorkspaceId } from "../../shared/domain/value-objects/workspace-id.ts";
import type { WipeMemory } from "../../modules/memory/application/ports/in/wipe-memory.port.ts";
import type {
  MemoryWipeFacade,
  MemoryWipeFacadeOutcome,
} from "../../modules/workspace/application/ports/out/memory-wipe-facade.port.ts";

/**
 * Adapter implementing {@link MemoryWipeFacade} on top of the
 * memory module's `WipeMemoryUseCase`.
 *
 * The memory use case returns a richer envelope (workspaceId,
 * wipedAtMs, rowsDeleted); this adapter projects only the count the
 * workspace module needs. The `wipedAtMs` is irrelevant here —
 * `DestroyWorkspaceUseCase` stamps its own `WorkspaceDestroyed`
 * event with the correct timestamp.
 */
export class MemoryWipeFacadeAdapter implements MemoryWipeFacade {
  public constructor(private readonly useCase: WipeMemory) {}

  public async wipe(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<MemoryWipeFacadeOutcome> {
    const result = await this.useCase.wipe({ workspaceId: input.workspaceId });
    return { rowsDeleted: result.rowsDeleted };
  }
}
