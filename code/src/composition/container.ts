/**
 * Top-level dependency-injection container for the MCP Memoria
 * application.
 *
 * The container is the cross-module wiring site mandated by
 * `docs/12-lineamientos-arquitectura.md` §1.5 Regla 4 (the only
 * place where multi-module imports are legal). It builds in this
 * exact order:
 *
 *   1. `SharedAdapters`       (Logger, Clock, IdGenerator, Embedder).
 *   2. `InMemoryEventBus` + `EventBusPublisher` (the cross-module
 *      bus and its `EventPublisher` adapter).
 *   3. `EncryptionWiring`     (cipher / KDF / use cases; uses 1 + 2 +
 *                              workspaceRoot).
 *   4. Workspace-side encryption facades   (cross-module; uses 3).
 *   5. `WorkspaceWiring`      (filesystem, db bootstrap, use cases;
 *                              uses 1 + 4).
 *   6. The workspace's database is opened lazily via the
 *      `DatabaseBootstrap` adapter; the rest of the modules need a
 *      live `DatabaseConnection` though, so the bootstrap entrypoint
 *      opens one explicitly via `SqliteDatabase.open` and passes it
 *      down to:
 *   7. `SecretsWiring`        (uses 1 + db).
 *   8. `RetrievalWiring`      (uses 1 + db).
 *   9. `MemoryWiring`         (uses 1 + 2 + db + workspaceId).
 *  10. `CuratorWiring`        (uses 1 + db + workspace root + the
 *                              memory module's repositories).
 *  11. mcp-server facades     (cross-module; uses 5-10).
 *  12. `McpServerWiring`      (uses 1 + 11).
 *  13. CLI facades            (cross-module; uses 5 + 7 + 9 + 10).
 *  14. `CliWiring`            (uses 1 + 13).
 *
 * Why a hand-rolled container (and not a DI library):
 * - The wiring graph has < 100 nodes; a hand-rolled container is
 *   trivially understandable and has zero runtime overhead.
 * - The graph is acyclic by construction; we do not need lazy proxies.
 * - The graph is owned by the composition root file; a library
 *   would invert that ownership.
 *
 * The container is **not** the entrypoint: see
 * `bootstrap/cli-entrypoint.ts` and `bootstrap/mcp-server-entrypoint.ts`
 * for the runtime drivers.
 */

import type { DatabaseConnection } from "../shared/application/ports/database-connection.port.ts";
import type { Embedder as RawEmbedder } from "../shared/application/ports/embedder.port.ts";
import type { Clock } from "../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../shared/application/ports/logger.port.ts";
import { WorkspaceId } from "../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionKeyBytes } from "../shared/infrastructure/database/sqlite-database.ts";
import { EmbedderSpec } from "../modules/workspace/domain/value-objects/embedder-spec.ts";
import { EventBusPublisher } from "./event-bus/event-bus-publisher.ts";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.ts";
import type { DomainEventBus } from "./event-bus/in-memory-event-bus.ts";
import {
  CheckHealthFacadeAdapter,
  GetContextFacadeAdapter,
  InitializeWorkspaceFacadeAdapter,
  RecallMemoryFacadeAdapter,
  RememberFacadeAdapter,
  TrackTaskFacadeAdapter,
} from "./facades/mcp-server-facades.ts";
import {
  CliAuditFacadeAdapter,
  CliChangeModeFacadeAdapter,
  CliCuratorLogFacadeAdapter,
  CliCuratorRunFacadeAdapter,
  CliExportFacadeAdapter,
  CliHealthCheckFacadeAdapter,
  CliImportFacadeAdapter,
  CliImportHandoffFacadeAdapter,
  CliInitializeWorkspaceFacadeAdapter,
  CliInstallHookFacadeAdapter,
  CliLockWorkspaceFacadeAdapter,
  CliResetQueueFacadeAdapter,
  CliSanitizeFacadeAdapter,
  CliStatsFacadeAdapter,
  CliUninstallHookFacadeAdapter,
  CliUnlockWorkspaceFacadeAdapter,
  CliWipeFacadeAdapter,
  PendingAddKeyFacade,
  PendingExportKeyFacade,
  PendingRekeyFacade,
  PendingServerFacade,
} from "./facades/cli-facades.ts";
import {
  DestroyEncryptionFacadeAdapter,
  InitializeEncryptionFacadeAdapter,
  LockEncryptionFacadeAdapter,
  UnlockEncryptionFacadeAdapter,
} from "./facades/workspace-encryption-facades.ts";
import { registerMvpTools } from "./tools/tool-registry-bootstrap.ts";
import type { CliWiring } from "./wiring/cli-wiring.ts";
import { buildCliWiring } from "./wiring/cli-wiring.ts";
import type { CuratorWiring } from "./wiring/curator-wiring.ts";
import { buildCuratorWiring } from "./wiring/curator-wiring.ts";
import type { EncryptionWiring } from "./wiring/encryption-wiring.ts";
import { buildEncryptionWiring } from "./wiring/encryption-wiring.ts";
import type { McpServerWiring } from "./wiring/mcp-server-wiring.ts";
import { buildMcpServerWiring } from "./wiring/mcp-server-wiring.ts";
import type { MemoryWiring } from "./wiring/memory-wiring.ts";
import { buildMemoryWiring } from "./wiring/memory-wiring.ts";
import type { RetrievalWiring } from "./wiring/retrieval-wiring.ts";
import { buildRetrievalWiring } from "./wiring/retrieval-wiring.ts";
import type { SecretsWiring } from "./wiring/secrets-wiring.ts";
import { buildSecretsWiring } from "./wiring/secrets-wiring.ts";
import type { SharedAdapters, SharedAdaptersOptions } from "./wiring/shared-wiring.ts";
import { buildSharedAdapters } from "./wiring/shared-wiring.ts";
import type { WorkspaceWiring } from "./wiring/workspace-wiring.ts";
import {
  buildDestroyWorkspaceUseCase,
  buildWorkspaceWiring,
} from "./wiring/workspace-wiring.ts";
import { MemoryWipeFacadeAdapter } from "./facades/workspace-memory-facades.ts";
import { SqliteWorkspaceStateReader } from "./queries/sqlite-workspace-state-reader.ts";

/**
 * Public surface of the container the bootstrap entrypoints consume.
 *
 * Every field is the read-only result of one wiring helper. Nothing
 * here is mutable; the bootstrap drivers attach event handlers to
 * `eventBus` and start the appropriate transport.
 */
export interface Container {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly embedder: RawEmbedder;

  readonly database: DatabaseConnection;

  /**
   * Canonical workspace id pinned at construction time. Bootstrap
   * entrypoints resolve it from `<root>/.recall/config.json` BEFORE
   * `buildContainer` is called and pass it as
   * {@link ContainerOptions.workspaceId}; when absent (the
   * `skipDatabase: true` pre-init path), a deterministic placeholder
   * UUID v7 is supplied. Exposed so the bootstrap can wire process
   * lifecycle helpers (e.g. drive `retrieval.embeddingWorker`) without
   * re-resolving the id.
   */
  readonly workspaceId: WorkspaceId;

  readonly workspace: WorkspaceWiring;
  readonly encryption: EncryptionWiring;
  readonly secrets: SecretsWiring;
  readonly retrieval: RetrievalWiring;
  readonly memory: MemoryWiring;
  readonly curator: CuratorWiring;

  readonly mcpServer: McpServerWiring;
  readonly cli: CliWiring;

  readonly eventBus: DomainEventBus;
  readonly eventPublisher: EventPublisher;
}

/**
 * Construction options for {@link buildContainer}. Carry the
 * environment-specific values the bootstrap entrypoints supply
 * (workspace path, migrations dir, database connection, server
 * info).
 */
export interface ContainerOptions {
  readonly shared: SharedAdaptersOptions;
  /** Absolute path to the workspace root (the directory that holds
   *  `.recall/`). */
  readonly workspaceRoot: string;
  /** Absolute path to the bundled `code/migrations/` directory. */
  readonly migrationsDir: string;
  /** Live `DatabaseConnection` opened by the bootstrap entrypoint
   *  (a `SqliteDatabase` against `<workspaceRoot>/.recall/recall.db`). */
  readonly database: DatabaseConnection;
  /** Resolver the workspace's database bootstrap calls when the mode
   *  is `encrypted`. Wired by the bootstrap entrypoint to a closure
   *  that looks up the encryption module's unlocked-key cache. */
  readonly encryptionKeyResolver: (input: {
    readonly mode: "shared" | "encrypted" | "private";
    readonly databasePath: string;
  }) => Promise<EncryptionKeyBytes | null>;
  /** Schema version stamped on `mem.health` envelopes. */
  readonly schemaVersion: string;
  /** MCP server info advertised on `initialize`. */
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
    readonly protocolVersion: string;
  };
  /** Default embedder spec written into fresh `config.json` files.
   *  Optional; defaults to `fastembed:BGESmallEN15` (384-dim). */
  readonly defaultEmbedder?: EmbedderSpec;
  /**
   * Workspace id pinned at the boundary of the memory wiring. The
   * bootstrap caller resolves the canonical id from the workspace's
   * `config.json` BEFORE building the container; for the
   * `skipDatabase: true` path (the CLI's pre-init mode) a
   * placeholder UUID is acceptable because no memory operation will
   * fire against the placeholder workspace.
   */
  readonly workspaceId?: WorkspaceId;
}

/**
 * Builds the full container in one pass. The function is **sync**
 * because every adapter constructor is sync; async work (model
 * download, database open) happens inside the bootstrap entrypoint
 * before this is called.
 */
export function buildContainer(options: ContainerOptions): Container {
  // Step 1 — shared adapters.
  const shared: SharedAdapters = buildSharedAdapters(options.shared);
  const logger = shared.logger;

  // Step 2 — event bus + publisher.
  const eventBus = new InMemoryEventBus(logger);
  const eventPublisher: EventPublisher = new EventBusPublisher(eventBus);

  // Step 3 — encryption module (no database dependency; pure crypto
  // + filesystem persistence under <workspaceRoot>/.recall/).
  const encryption = buildEncryptionWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    eventPublisher,
    workspaceRoot: options.workspaceRoot,
  });

  // Step 4 — workspace-side cross-module facades.
  const initializeEncryptionFacade = new InitializeEncryptionFacadeAdapter(
    encryption.initializeEncryption,
  );
  const unlockEncryptionFacade = new UnlockEncryptionFacadeAdapter(
    encryption.unlockEncryption,
  );
  const lockEncryptionFacade = new LockEncryptionFacadeAdapter(
    encryption.lockEncryption,
  );
  const destroyEncryptionFacade = new DestroyEncryptionFacadeAdapter(
    encryption.destroyEncryption,
  );

  // Step 5 — workspace.
  const workspace = buildWorkspaceWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    embedder: shared.embedder,
    migrationsDir: options.migrationsDir,
    encryptionKeyResolver: options.encryptionKeyResolver,
    initializeEncryptionFacade,
    unlockEncryptionFacade,
    lockEncryptionFacade,
    destroyEncryptionFacade,
  });

  // Step 6 — workspace id resolution. The memory + curator wirings
  // pin the workspace id at construction; the bootstrap caller is
  // expected to resolve the canonical id from the workspace's
  // `config.json` BEFORE building the container. For the CLI's
  // pre-init path (`skipDatabase: true`), a deterministic
  // placeholder UUID v7 is supplied so the type system stays happy
  // without any memory operation actually firing.
  //
  // The placeholder must satisfy `Id.isUuidV7`: version nibble `7`
  // in the third group, variant nibble in {8, 9, a, b} in the fourth
  // group. `00000000-0000-7000-8000-000000000000` is the canonical
  // null-v7 placeholder used by the project.
  const workspaceId =
    options.workspaceId ??
    WorkspaceId.from("00000000-0000-7000-8000-000000000000");

  // Steps 7-9 — modules that need the live database connection.
  const secrets = buildSecretsWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    database: options.database,
  });
  const retrieval = buildRetrievalWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    database: options.database,
    embedder: shared.retrievalEmbedder,
    workspaceId,
  });
  const memory = buildMemoryWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    eventPublisher,
    database: options.database,
    workspaceId,
  });

  // Step 9.5 — late-bind the workspace's `DestroyWorkspaceUseCase`
  // now that the memory module exists. The use case orchestrates
  // SQL truncation (via the memory wipe facade) + on-disk
  // teardown (via the workspace filesystem) + key forget (via the
  // encryption lock facade) under one driving port. Tarea 5.3 —
  // Bug 2 fix.
  const memoryWipeFacade = new MemoryWipeFacadeAdapter(memory.wipeMemory);
  const destroyWorkspaceUseCase = buildDestroyWorkspaceUseCase({
    workspaceWiring: workspace,
    clock: shared.clock,
    logger,
    eventPublisher,
    memoryWipeFacade,
    lockEncryptionFacade,
  });
  const fullWorkspaceWiring: WorkspaceWiring = {
    ...workspace,
    destroyWorkspace: destroyWorkspaceUseCase,
  };

  // Step 10 — curator (uses the memory repositories).
  const curator = buildCuratorWiring({
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    database: options.database,
    workspaceRoot: options.workspaceRoot,
    learningRepository: memory.learnings,
    sessionRepository: memory.sessions,
  });

  // Step 11 — mcp-server cross-module facades.
  const defaultEmbedder =
    options.defaultEmbedder ??
    EmbedderSpec.create({
      provider: "fastembed",
      model: "BGESmallEN15",
    });
  // The mcp-server facade adapters resolve the workspace id from
  // their constructor-injected default when the wire input omits
  // `workspace_id` (B-MCP-1). Real MCP clients always omit the
  // field; the bootstrap reads `<workspaceRoot>/.recall/config.json`
  // and pins `workspaceId` on the container so the facades can
  // service those calls without a wire override.
  const mcpServerFacades = {
    init: new InitializeWorkspaceFacadeAdapter(
      workspace.initializeWorkspace,
      defaultEmbedder,
      logger,
    ),
    context: new GetContextFacadeAdapter(
      retrieval.getContextBundle,
      workspaceId,
    ),
    recall: new RecallMemoryFacadeAdapter(retrieval.recallMemory, workspaceId),
    remember: new RememberFacadeAdapter(
      memory.recordDecision,
      memory.recordLearning,
      memory.recordEntity,
      memory.recordTurn,
      memory.trackTask,
      workspaceId,
    ),
    task: new TrackTaskFacadeAdapter(memory.trackTask, workspaceId),
    health: new CheckHealthFacadeAdapter(
      workspace.healthCheck,
      new SqliteWorkspaceStateReader(options.database, logger),
      options.workspaceRoot,
      options.schemaVersion,
      "fastembed:BGESmallEN15",
      workspaceId,
    ),
  };

  // Step 12 — mcp-server module.
  const mcpServer = buildMcpServerWiring({
    logger,
    clock: shared.clock,
    facades: mcpServerFacades,
    serverInfo: options.serverInfo,
  });
  registerMvpTools({ registry: mcpServer.registry, clock: shared.clock });

  // Step 13 — CLI cross-module facades + module.
  const cliFacades = {
    initializeWorkspace: new CliInitializeWorkspaceFacadeAdapter(
      workspace.initializeWorkspace,
      defaultEmbedder,
    ),
    unlockWorkspace: new CliUnlockWorkspaceFacadeAdapter(workspace.unlockWorkspace),
    lockWorkspace: new CliLockWorkspaceFacadeAdapter(workspace.lockWorkspace),
    changeMode: new CliChangeModeFacadeAdapter(workspace.changeMode),
    health: new CliHealthCheckFacadeAdapter(workspace.healthCheck),

    exportKey: new PendingExportKeyFacade(),
    rekey: new PendingRekeyFacade(),
    addKey: new PendingAddKeyFacade(),

    audit: new CliAuditFacadeAdapter(memory.auditMemory, workspace.detectWorkspace),
    sanitize: new CliSanitizeFacadeAdapter(secrets.sanitizePath),
    installHook: new CliInstallHookFacadeAdapter(
      secrets.installPreCommitHook,
      logger,
    ),
    uninstallHook: new CliUninstallHookFacadeAdapter(
      secrets.uninstallPreCommitHook,
      logger,
    ),

    curatorRun: new CliCuratorRunFacadeAdapter(
      curator.runCurator,
      workspace.detectWorkspace,
    ),
    curatorLog: new CliCuratorLogFacadeAdapter(
      curator.curatorRuns,
      workspace.detectWorkspace,
    ),
    resetQueue: new CliResetQueueFacadeAdapter(
      retrieval.resetEmbeddingQueue,
      workspace.detectWorkspace,
    ),

    importHandoff: new CliImportHandoffFacadeAdapter(
      memory.importHandoff,
      workspace.detectWorkspace,
    ),
    export: new CliExportFacadeAdapter(
      memory.exportMemory,
      workspace.detectWorkspace,
    ),
    import: new CliImportFacadeAdapter(
      memory.importMemory,
      workspace.detectWorkspace,
    ),
    wipe: new CliWipeFacadeAdapter(destroyWorkspaceUseCase),
    stats: new CliStatsFacadeAdapter(
      memory.statsMemory,
      workspace.detectWorkspace,
    ),
    server: new PendingServerFacade(),
  };
  const cli = buildCliWiring({ logger, facades: cliFacades });

  return {
    logger,
    clock: shared.clock,
    idGenerator: shared.idGenerator,
    embedder: shared.embedder,
    database: options.database,
    workspaceId,
    workspace: fullWorkspaceWiring,
    encryption,
    secrets,
    retrieval,
    memory,
    curator,
    mcpServer,
    cli,
    eventBus,
    eventPublisher,
  };
}
