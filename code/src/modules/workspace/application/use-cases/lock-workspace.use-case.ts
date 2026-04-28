import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { NoWorkspaceAtPathError } from "../errors/workspace-application-error.ts";
import type {
  LockWorkspace,
  LockWorkspaceInput,
  LockWorkspaceOutput,
} from "../ports/in/lock-workspace.port.ts";
import type { LockEncryptionFacade } from "../ports/out/lock-encryption-facade.port.ts";
import type { DetectWorkspace } from "../ports/in/detect-workspace.port.ts";

/**
 * Implements `LockWorkspace`.
 *
 * Algorithm:
 *   1. Detect the workspace; raise `NoWorkspaceAtPathError` if none.
 *   2. Non-encrypted workspaces: idempotent no-op (`wasLocked: false`).
 *   3. Encrypted workspaces:
 *      a. If already locked, no-op.
 *      b. Else delegate to `LockEncryptionFacade`, which wipes the
 *         on-disk key cache and the in-process master key.
 *      c. Reflect the change on the aggregate via `Workspace.lock`.
 *
 * The aggregate's `lock` method is invariant-checked (refuses to
 * lock a non-encrypted or already-locked workspace), so we guard
 * with `isUnlocked()` before calling. Any inconsistency between the
 * aggregate and the encryption facade emits a warning and is
 * resolved in favour of the facade (the source of truth for the
 * on-disk cache).
 */
export class LockWorkspaceUseCase implements LockWorkspace {
  public constructor(
    private readonly detect: DetectWorkspace,
    private readonly facade: LockEncryptionFacade,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async lock(input: LockWorkspaceInput): Promise<LockWorkspaceOutput> {
    const detection = await this.detect.detect({ startPath: input.rootPath });
    if (!detection.found) {
      throw new NoWorkspaceAtPathError(input.rootPath.toString());
    }

    const { workspace } = detection;
    if (!workspace.getMode().isEncrypted()) {
      this.logger.debug(
        { workspaceId: workspace.getId().toString() },
        "lock requested on non-encrypted workspace; no-op",
      );
      return { workspace, wasLocked: false };
    }

    if (!workspace.isUnlocked()) {
      this.logger.debug(
        { workspaceId: workspace.getId().toString() },
        "lock requested on already-locked workspace; no-op",
      );
      return { workspace, wasLocked: false };
    }

    const outcome = await this.facade.lock({
      workspaceId: workspace.getId(),
    });

    if (!outcome.locked) {
      this.logger.warn(
        {
          workspaceId: workspace.getId().toString(),
          reason: outcome.reason,
        },
        "lock facade reported a no-op outcome; treating as success",
      );
      return { workspace, wasLocked: false };
    }

    workspace.lock({ occurredAt: this.clock.now() });

    this.logger.info(
      { workspaceId: workspace.getId().toString() },
      "workspace locked",
    );

    return { workspace, wasLocked: true };
  }
}
