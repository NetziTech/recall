import * as path from "node:path";

import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { WorkspaceDestroyed } from "../../domain/events/workspace-destroyed.ts";
import { NoWorkspaceAtPathError } from "../errors/workspace-application-error.ts";
import type {
  DestroyWorkspace,
  DestroyWorkspaceInput,
  DestroyWorkspaceOutput,
} from "../ports/in/destroy-workspace.port.ts";
import type { DetectWorkspace } from "../ports/in/detect-workspace.port.ts";
import type { LockEncryptionFacade } from "../ports/out/lock-encryption-facade.port.ts";
import type { MemoryWipeFacade } from "../ports/out/memory-wipe-facade.port.ts";
import type { WorkspaceFilesystem } from "../ports/out/workspace-filesystem.port.ts";

/**
 * Canonical name of the workspace directory removed by this flow.
 * Mirrors `docs/03-modelo-datos.md` §1. Kept as a constant here so
 * the result envelope can report `<root>/.mcp-memoria` without
 * depending on the filesystem adapter's internal constant.
 */
const WORKSPACE_DIRECTORY_NAME = ".mcp-memoria";

/**
 * Implements the `DestroyWorkspace` driving port — the use case
 * behind `mcp-memoria wipe`.
 *
 * Algorithm (Tarea 5.3 — Bug 2 fix):
 *
 *   1. Refuse the call when `confirmed === false` (defense-in-depth
 *      against accidental invocation; the CLI's literal `WIPE`
 *      prompt is the primary gate one layer up).
 *   2. Detect the workspace at `rootPath`. Raise `NoWorkspaceAtPathError`
 *      when nothing is on disk — the CLI maps this to a "no hay nada
 *      que borrar" message.
 *   3. For encrypted workspaces, lock first via the
 *      `LockEncryptionFacade`. The on-disk key cache must be wiped
 *      BEFORE the directory disappears so a subsequent `init` cannot
 *      accidentally pick up a stale envelope from
 *      `~/.config/mcp-memoria/keys/`.
 *   4. Truncate the SQL tables via the `MemoryWipeFacade` (the
 *      memory module's `WipeMemoryUseCase`). Errors propagate; a
 *      half-wiped database is recoverable by re-running `wipe`.
 *   5. Remove the entire `<root>/.mcp-memoria/` directory tree via
 *      the workspace filesystem adapter. The adapter performs path
 *      canonicalisation (rejects anything that does not end with the
 *      `.mcp-memoria` segment).
 *   6. Emit `WorkspaceDestroyed` so subscribers (audit log,
 *      telemetry) record the wipe.
 *
 * Why all six steps live here (not split across modules):
 *   - Wipe is an operator-driven cleanup that must be atomic from
 *     the operator's perspective: SQL truncation + key teardown +
 *     directory removal + event are one logical operation. Splitting
 *     them across modules would force the CLI to orchestrate the
 *     ordering, which it should not — the CLI is a transport, not a
 *     coordinator.
 *   - The workspace module owns the `.mcp-memoria/` directory's
 *     lifecycle (create/remove). The memory module owns the SQL
 *     truncation. Composing them through facade ports keeps the
 *     ownership clean and the cross-module imports forbidden.
 *
 * Failure modes:
 *   - SQL wipe fails mid-flow → directory still exists, partial SQL
 *     state. Re-running `wipe` re-tries from scratch (the truncation
 *     SQL is idempotent: deleting from an empty table is a no-op).
 *   - Filesystem removal fails after a successful SQL wipe → the
 *     workspace's SQL is empty but the directory remains. The
 *     operator can manually `rm -rf .mcp-memoria/` or re-run wipe
 *     (which will re-run the truncation no-op then retry the
 *     removal).
 */
export class DestroyWorkspaceUseCase implements DestroyWorkspace {
  public constructor(
    private readonly detect: DetectWorkspace,
    private readonly memoryWipe: MemoryWipeFacade,
    private readonly lockEncryption: LockEncryptionFacade,
    private readonly filesystem: WorkspaceFilesystem,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async destroy(
    input: DestroyWorkspaceInput,
  ): Promise<DestroyWorkspaceOutput> {
    if (!input.confirmed) {
      throw new InvalidInputError(
        "wipe requires explicit confirmation; CLI must enforce the WIPE literal or --confirm flag",
        { field: "confirmed" },
      );
    }

    const detection = await this.detect.detect({ startPath: input.rootPath });
    if (!detection.found) {
      throw new NoWorkspaceAtPathError(input.rootPath.toString());
    }

    const { workspace, rootPath } = detection;
    const workspaceId = workspace.getId();
    const removedPath = path.join(
      rootPath.toString(),
      WORKSPACE_DIRECTORY_NAME,
    );

    // 1. Lock encryption first — wipes the on-disk key cache.
    if (workspace.getMode().isEncrypted() && workspace.isUnlocked()) {
      const outcome = await this.lockEncryption.lock({ workspaceId });
      if (!outcome.locked) {
        this.logger.warn(
          { workspaceId: workspaceId.toString(), reason: outcome.reason },
          "lock-encryption returned no-op during wipe; continuing",
        );
      }
    }

    // 2. Truncate SQL tables.
    const wipeOutcome = await this.memoryWipe.wipe({ workspaceId });

    // 3. Remove the workspace directory tree (defense-in-depth path
    //    canonicalisation lives in the filesystem adapter).
    await this.filesystem.removeWorkspaceDirectory(rootPath);

    // 4. Emit the domain event.
    const occurredAt = this.clock.now();
    await this.events.publishAll([
      new WorkspaceDestroyed({
        workspaceId,
        removedPath,
        occurredAt,
      }),
    ]);

    this.logger.warn(
      {
        workspaceId: workspaceId.toString(),
        removedPath,
        rowsDeleted: wipeOutcome.rowsDeleted,
      },
      "workspace destroyed",
    );

    return {
      workspaceId,
      removedPath,
      rowsDeleted: wipeOutcome.rowsDeleted,
    };
  }
}
