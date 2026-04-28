import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { WorkspaceLockedError } from "../../domain/errors/workspace-locked-error.ts";
import { NoWorkspaceAtPathError } from "../errors/workspace-application-error.ts";
import type {
  UnlockWorkspace,
  UnlockWorkspaceInput,
  UnlockWorkspaceOutput,
} from "../ports/in/unlock-workspace.port.ts";
import type { UnlockEncryptionFacade } from "../ports/out/unlock-encryption-facade.port.ts";
import type { DetectWorkspace } from "../ports/in/detect-workspace.port.ts";

/**
 * Implements `UnlockWorkspace`. The flow is:
 *
 *   1. Detect the workspace at `rootPath`. If none exists, raise
 *      `NoWorkspaceAtPathError` so the CLI can surface the
 *      `invalidConfig` exit code.
 *   2. If the workspace is not in `encrypted` mode, return it
 *      unchanged with `wasUnlocked: false`. Shared/private workspaces
 *      do not have a lock state.
 *   3. Otherwise delegate to the encryption facade. On success, mark
 *      the aggregate as unlocked via `Workspace.unlock`. On a
 *      `key-validation-failed` outcome surface
 *      `WorkspaceLockedError` so the caller surfaces the documented
 *      `-32107 ENCRYPTED_LOCKED` / exit code `lockedWorkspace`.
 *
 * Note: the use case does NOT persist the workspace after unlocking —
 * the `unlocked` flag is runtime-only (see
 * `WorkspaceRepository`'s contract). The encryption module's adapter
 * is responsible for caching the key in
 * `~/.config/mcp-memoria/keys/...`.
 */
export class UnlockWorkspaceUseCase implements UnlockWorkspace {
  public constructor(
    private readonly detect: DetectWorkspace,
    private readonly facade: UnlockEncryptionFacade,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async unlock(
    input: UnlockWorkspaceInput,
  ): Promise<UnlockWorkspaceOutput> {
    const detection = await this.detect.detect({ startPath: input.rootPath });
    if (!detection.found) {
      throw new NoWorkspaceAtPathError(input.rootPath.toString());
    }

    const { workspace } = detection;
    if (!workspace.getMode().isEncrypted()) {
      this.logger.debug(
        {
          workspaceId: workspace.getId().toString(),
          mode: workspace.getMode().toString(),
        },
        "unlock requested on non-encrypted workspace; no-op",
      );
      return { workspace, wasUnlocked: false };
    }

    if (workspace.isUnlocked()) {
      this.logger.debug(
        { workspaceId: workspace.getId().toString() },
        "unlock requested on already-unlocked workspace; no-op",
      );
      return { workspace, wasUnlocked: false };
    }

    const outcome = await this.facade.unlock({
      workspaceId: workspace.getId(),
      passphrase: input.passphrase,
    });

    if (!outcome.unlocked) {
      if (outcome.reason === "not-encrypted") {
        // Defensive: the workspace and the encryption module disagree
        // on the mode. Treat as no-op success; emit a warning.
        this.logger.warn(
          { workspaceId: workspace.getId().toString() },
          "encryption facade reports not-encrypted but workspace says encrypted; treating as no-op",
        );
        return { workspace, wasUnlocked: false };
      }
      // key-validation-failed → user typed the wrong passphrase.
      throw new WorkspaceLockedError(workspace.getId());
    }

    workspace.unlock({ occurredAt: this.clock.now() });

    this.logger.info(
      { workspaceId: workspace.getId().toString() },
      "workspace unlocked",
    );

    return { workspace, wasUnlocked: true };
  }
}
