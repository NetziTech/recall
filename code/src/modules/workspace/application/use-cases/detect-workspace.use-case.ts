import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Workspace } from "../../domain/aggregates/workspace.ts";
import type { WorkspaceDetector } from "../../domain/services/workspace-detector.ts";
import { DisplayName } from "../../domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../domain/value-objects/embedder-spec.ts";
import { WorkspaceConfig } from "../../domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../domain/value-objects/workspace-mode.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../ports/in/detect-workspace.port.ts";
import type {
  PersistedWorkspaceConfig,
  WorkspaceFilesystem,
} from "../ports/out/workspace-filesystem.port.ts";

/**
 * Implements the `DetectWorkspace` driving port.
 *
 * Delegates the upward filesystem walk to the
 * {@link WorkspaceDetector} domain service (the adapter for it lives
 * in `infrastructure/detection/`). When the detector reports a hit,
 * the use case reads `config.json` via the filesystem port, decodes
 * the persistent slice into the `WorkspaceConfig` VO, and rehydrates
 * the aggregate.
 *
 * Edge cases:
 *   - `detector.detect` returning `{ exists: false, configPath: null }`
 *     yields `{ found: false, ... }`; the caller decides whether to
 *     fall back to `mcp-memoria init`.
 *   - A detector hit with a malformed `config.json` propagates the
 *     parse error from the filesystem adapter unchanged. We do NOT
 *     swallow it: a malformed config is a hard failure that the user
 *     must fix.
 */
export class DetectWorkspaceUseCase implements DetectWorkspace {
  public constructor(
    private readonly detector: WorkspaceDetector,
    private readonly filesystem: WorkspaceFilesystem,
    private readonly logger: Logger,
  ) {}

  public async detect(
    input: DetectWorkspaceInput,
  ): Promise<DetectWorkspaceOutput> {
    const detection = await this.detector.detect(input.startPath);
    if (!detection.exists) {
      this.logger.debug(
        { startPath: input.startPath.toString() },
        "no workspace found upward from start path",
      );
      return { found: false, workspace: null, rootPath: null };
    }

    const persisted = await this.filesystem.readConfig(detection.configPath);
    const config = DetectWorkspaceUseCase.toDomainConfig(persisted);
    const workspace = Workspace.rehydrate(config);

    this.logger.debug(
      {
        workspaceId: workspace.getId().toString(),
        mode: workspace.getMode().toString(),
        rootPath: detection.configPath.toString(),
      },
      "workspace detected and rehydrated",
    );

    return {
      found: true,
      workspace,
      rootPath: detection.configPath,
    };
  }

  private static toDomainConfig(
    persisted: PersistedWorkspaceConfig,
  ): WorkspaceConfig {
    return WorkspaceConfig.create({
      schemaVersion: persisted.schemaVersion,
      workspaceId: WorkspaceId.from(persisted.workspaceId),
      displayName: DisplayName.create(persisted.displayName),
      mode: WorkspaceMode.create(persisted.mode),
      embedder: EmbedderSpec.create({
        provider: persisted.embedder.provider,
        model: persisted.embedder.model,
        dim: persisted.embedder.dim,
      }),
      createdAt: Timestamp.fromEpochMs(persisted.createdAtMs),
    });
  }
}
