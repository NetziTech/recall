import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { Workspace } from "../../domain/aggregates/workspace.ts";
import { NoWorkspaceAtPathError } from "../errors/workspace-application-error.ts";
import type {
  ChangeMode,
  ChangeModeInput,
  ChangeModeOutput,
} from "../ports/in/change-mode.port.ts";
import type { DestroyEncryptionFacade } from "../ports/out/destroy-encryption-facade.port.ts";
import type { InitializeEncryptionFacade } from "../ports/out/initialize-encryption-facade.port.ts";
import type {
  PersistedWorkspaceConfig,
  WorkspaceFilesystem,
} from "../ports/out/workspace-filesystem.port.ts";
import type { WorkspaceProjectionWriter } from "../ports/out/workspace-projection-writer.port.ts";
import type { DetectWorkspace } from "../ports/in/detect-workspace.port.ts";

/**
 * Implements `ChangeMode`. Walks the matrix in
 * `docs/11-seguridad-modos.md` §5 ("Cambios de modo"):
 *
 *   shared    -> encrypted : init encryption slice + bootstrap key
 *   shared    -> private   : update .gitignore, no crypto
 *   encrypted -> private   : destroy encryption slice (decrypt DBs),
 *                            then update .gitignore. Pre-condition:
 *                            workspace MUST be unlocked.
 *   encrypted -> shared    : REJECTED at the aggregate level
 *                            (`InvalidModeTransitionError`); the use
 *                            case forwards the throw unchanged.
 *   private   -> shared    : remove from .gitignore, no crypto
 *   private   -> encrypted : init encryption slice + bootstrap key,
 *                            remove from .gitignore
 *
 * Persistence ordering:
 *   - For transitions INTO `encrypted`: init encryption FIRST so the
 *     on-disk slice is in place before `config.json` advertises the
 *     new mode.
 *   - For transitions OUT of `encrypted`: change `config.json` AFTER
 *     `destroy` so an interrupted operation is recoverable (the user
 *     retries with the workspace still in `encrypted` mode).
 *
 * The aggregate's state machine is the canonical authority: invalid
 * transitions raise `InvalidModeTransitionError` and bubble unchanged
 * to the caller.
 */
export class ChangeModeUseCase implements ChangeMode {
  public constructor(
    private readonly detect: DetectWorkspace,
    private readonly filesystem: WorkspaceFilesystem,
    private readonly initEncryptionFacade: InitializeEncryptionFacade,
    private readonly destroyEncryptionFacade: DestroyEncryptionFacade,
    private readonly projectionWriter: WorkspaceProjectionWriter,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async change(input: ChangeModeInput): Promise<ChangeModeOutput> {
    const detection = await this.detect.detect({ startPath: input.rootPath });
    if (!detection.found) {
      throw new NoWorkspaceAtPathError(input.rootPath.toString());
    }
    const { workspace, rootPath } = detection;
    const previousMode = workspace.getMode();

    // Pre-check: leaving `encrypted` requires the workspace unlocked.
    // The aggregate's `assertReadyForUse` raises `WorkspaceLockedError`
    // (mapped to JSON-RPC -32107).
    if (previousMode.isEncrypted()) {
      workspace.assertReadyForUse();
    }

    // Side effects BEFORE flipping the aggregate mode, in the order
    // documented above.
    const becomingEncrypted =
      input.newMode.isEncrypted() && !previousMode.isEncrypted();
    const leavingEncrypted =
      !input.newMode.isEncrypted() && previousMode.isEncrypted();

    if (becomingEncrypted) {
      if (input.passphrase === null || input.passphrase.length === 0) {
        throw new InvalidInputError(
          "transition into encrypted mode requires a non-empty passphrase",
          { field: "passphrase" },
        );
      }
      await this.initEncryptionFacade.initialize({
        workspaceId: workspace.getId(),
        passphrase: input.passphrase,
      });
    } else if (leavingEncrypted) {
      // The aggregate refuses `encrypted -> shared` directly; callers
      // are forced to go through `private` first. We trust the
      // domain to throw and only have to call `destroy` for the
      // valid transition `encrypted -> private`.
      //
      // The destroy facade requires a passphrase: the encryption
      // module re-validates authority by re-deriving a key from it
      // (the runtime "is unlocked" flag is not a sufficient
      // proof-of-ownership for an irrecoverable operation —
      // see `docs/11 §5`).
      if (input.passphrase === null || input.passphrase.length === 0) {
        throw new InvalidInputError(
          "transition out of encrypted mode requires the user to confirm with the workspace passphrase",
          { field: "passphrase" },
        );
      }
      await this.destroyEncryptionFacade.destroy({
        workspaceId: workspace.getId(),
        targetMode:
          input.newMode.toString() === "shared" ? "shared" : "private",
        passphrase: input.passphrase,
      });
    }

    // Flip the aggregate. This is where the state machine validates
    // the transition: invalid moves raise `InvalidModeTransitionError`.
    workspace.changeMode({
      newMode: input.newMode,
      occurredAt: this.clock.now(),
    });

    // Persist the workspace slice of `config.json` with the new mode.
    await this.filesystem.writeConfig(
      rootPath,
      ChangeModeUseCase.toPersisted(workspace),
    );

    // Re-project the identity row so the SQL `workspace_config` table
    // reflects the new mode for the next `mem.context` invocation.
    await this.projectionWriter.upsert({
      rootPath,
      config: workspace.getConfig(),
      updatedAtMs: this.clock.now().toEpochMs(),
    });

    // `.gitignore` policy is mode-driven; safe to reapply unconditionally.
    await this.filesystem.ensureGitignore(rootPath, input.newMode);

    this.logger.info(
      {
        workspaceId: workspace.getId().toString(),
        previousMode: previousMode.toString(),
        newMode: input.newMode.toString(),
      },
      "workspace mode changed",
    );

    return { workspace };
  }

  private static toPersisted(workspace: Workspace): PersistedWorkspaceConfig {
    const config = workspace.getConfig();
    return {
      schemaVersion: config.schemaVersion,
      workspaceId: config.workspaceId.toString(),
      displayName: config.displayName.toString(),
      mode: config.mode.toString(),
      createdAtMs: config.createdAt.toEpochMs(),
      embedder: {
        provider: config.embedder.provider,
        model: config.embedder.model,
        dim: config.embedder.dim,
      },
    };
  }
}
