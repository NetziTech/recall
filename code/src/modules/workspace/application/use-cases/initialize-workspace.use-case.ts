import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Workspace } from "../../domain/aggregates/workspace.ts";
import { DisplayName } from "../../domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../domain/value-objects/embedder-spec.ts";
import { WorkspaceConfig } from "../../domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../domain/value-objects/workspace-mode.ts";
import type {
  InitializeWorkspace,
  InitializeWorkspaceInput,
  InitializeWorkspaceOutput,
} from "../ports/in/initialize-workspace.port.ts";
import type { DatabaseBootstrap } from "../ports/out/database-bootstrap.port.ts";
import type { InitializeEncryptionFacade } from "../ports/out/initialize-encryption-facade.port.ts";
import type {
  PersistedWorkspaceConfig,
  WorkspaceFilesystem,
} from "../ports/out/workspace-filesystem.port.ts";
import type { WorkspaceProjectionWriter } from "../ports/out/workspace-projection-writer.port.ts";

/**
 * The persistent slice's `schema_version` minted by every fresh
 * workspace. Lives next to the use case rather than inside the VO so
 * the wire-format constant has one obvious home: the use case that
 * stamps it.
 */
const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * Implements the `InitializeWorkspace` driving port.
 *
 * Algorithm (per `docs/11-seguridad-modos.md` §§2-4 and
 * `docs/01-arquitectura.md` §2.2):
 *
 *   1. If `<root>/.recall/config.json` already exists, parse it,
 *      rehydrate the aggregate, and return `{ wasCreated: false }`.
 *      Idempotency rule: the existing workspace must already be in
 *      the requested mode; otherwise `Workspace.rejectReinitialization`
 *      raises `WorkspaceAlreadyInitializedError` so the caller can
 *      decide between rehydrating (call again with the right mode)
 *      or wiping (`recall wipe`).
 *   2. Otherwise: mint a fresh `WorkspaceId`, build the
 *      `WorkspaceConfig`, ask the filesystem adapter to create the
 *      directory tree, and persist `config.json`.
 *   3. For `encrypted` mode, delegate to
 *      `InitializeEncryptionFacade.initialize` AFTER the directory
 *      exists but BEFORE the database bootstrap so the encryption
 *      slice is on disk when SQLCipher opens the file.
 *   4. Bootstrap the database (open + run migrations).
 *   5. Apply the per-mode `.gitignore` policy.
 *   6. Pull buffered domain events (`Workspace.pullEvents`) — the
 *      composition root will dispatch them.
 *   7. Return the aggregate.
 *
 * Why split the side effects this way:
 *   - The encryption slice MUST be persisted before SQLCipher opens
 *     `recall.db` because the open path reads the on-disk
 *     KdfParams/envelopes via the encryption module.
 *   - The `.gitignore` pass is last so a half-finished init never
 *     leaves a stale ignore entry.
 */
export class InitializeWorkspaceUseCase implements InitializeWorkspace {
  public constructor(
    private readonly filesystem: WorkspaceFilesystem,
    private readonly databaseBootstrap: DatabaseBootstrap,
    private readonly encryptionFacade: InitializeEncryptionFacade,
    private readonly projectionWriter: WorkspaceProjectionWriter,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async initialize(
    input: InitializeWorkspaceInput,
  ): Promise<InitializeWorkspaceOutput> {
    const exists = await this.filesystem.workspaceExists(input.rootPath);
    if (exists) {
      return await this.rehydrate(input);
    }
    return await this.createFresh(input);
  }

  private async rehydrate(
    input: InitializeWorkspaceInput,
  ): Promise<InitializeWorkspaceOutput> {
    const persisted = await this.filesystem.readConfig(input.rootPath);
    const config = InitializeWorkspaceUseCase.toDomainConfig(persisted);
    const workspace = Workspace.rehydrate(config);

    if (!workspace.getMode().equals(input.mode)) {
      // Surface the mismatch via the dedicated domain error so the
      // CLI can render a Spanish message ("Ya existe un workspace
      // en modo X; pediste Y. Ejecuta wipe o cambia el modo
      // explicitamente.").
      workspace.rejectReinitialization();
    }

    // Re-bootstrap the database. The migrations runner is idempotent:
    // pending migrations apply, the rest are skipped. This also brings
    // older workspaces (created before migration 006) up to date so
    // their `workspace_config` table exists before the projection
    // upsert below.
    await this.databaseBootstrap.bootstrap({
      rootPath: input.rootPath,
      mode: workspace.getMode(),
    });

    // Re-project the workspace identity row. Idempotent upsert: a fresh
    // workspace lands a new row, an existing one gets `updated_at_ms`
    // bumped. This closes the migration-window gap for workspaces that
    // were initialised before migration 006 was shipped.
    await this.projectionWriter.upsert({
      rootPath: input.rootPath,
      config,
      updatedAtMs: this.clock.now().toEpochMs(),
    });

    this.logger.info(
      {
        workspaceId: workspace.getId().toString(),
        mode: workspace.getMode().toString(),
        rootPath: input.rootPath.toString(),
      },
      "workspace already exists; rehydrated existing config",
    );

    return { workspace, wasCreated: false };
  }

  private async createFresh(
    input: InitializeWorkspaceInput,
  ): Promise<InitializeWorkspaceOutput> {
    const workspaceIdRaw = this.idGenerator.generateString();
    const typedWorkspaceId = WorkspaceId.from(workspaceIdRaw);
    const occurredAt = this.clock.now();

    const config = WorkspaceConfig.create({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      workspaceId: typedWorkspaceId,
      displayName: input.displayName,
      mode: input.mode,
      embedder: input.embedder,
      createdAt: occurredAt,
    });

    const workspace = Workspace.initialize({ config, occurredAt });

    // 1. Directory tree.
    await this.filesystem.createWorkspaceDirectory(input.rootPath);

    // 2. Encryption slice (only in encrypted mode).
    if (input.mode.isEncrypted()) {
      if (input.passphrase === null || input.passphrase.length === 0) {
        // The application layer (CLI parser, MCP handler) is required
        // to gather a passphrase before invoking this use case for
        // encrypted mode. We assert defensively so a misconfigured
        // caller surfaces a typed invariant violation rather than
        // producing an empty envelope.
        throw new InvalidInputError(
          "encrypted workspace initialisation requires a non-empty passphrase",
          { field: "passphrase" },
        );
      }
      await this.encryptionFacade.initialize({
        workspaceId: typedWorkspaceId,
        passphrase: input.passphrase,
      });
    }

    // 3. Persist the workspace slice of `config.json`.
    await this.filesystem.writeConfig(
      input.rootPath,
      InitializeWorkspaceUseCase.toPersisted(config),
    );

    // 4. Bootstrap database + migrations.
    await this.databaseBootstrap.bootstrap({
      rootPath: input.rootPath,
      mode: input.mode,
    });

    // 5. Project the workspace identity into the SQL `workspace_config`
    //    table so the retrieval module's `mem.context` anchor layer
    //    can read it. The bootstrap step above MUST have applied
    //    migration 006 (the table-creating migration) before we get
    //    here — the projection writer trusts the schema is in place.
    await this.projectionWriter.upsert({
      rootPath: input.rootPath,
      config,
      updatedAtMs: occurredAt.toEpochMs(),
    });

    // 6. `.gitignore` policy.
    await this.filesystem.ensureGitignore(input.rootPath, input.mode);

    this.logger.info(
      {
        workspaceId: typedWorkspaceId.toString(),
        mode: input.mode.toString(),
        rootPath: input.rootPath.toString(),
      },
      "workspace initialised",
    );

    return { workspace, wasCreated: true };
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

  private static toPersisted(
    config: WorkspaceConfig,
  ): PersistedWorkspaceConfig {
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
