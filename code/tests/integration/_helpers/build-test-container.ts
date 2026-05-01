/**
 * Integration-test container builder.
 *
 * The production composition root (`src/composition/container.ts`) wires
 * a `FastembedEmbedder` from `buildSharedAdapters`. That adapter is lazy
 * (no model download until `.embed()` is called), but several of our
 * end-to-end flows DO call recall, which would force the download.
 *
 * For integration tests we want:
 *   - The full DI graph (every wiring helper, every facade adapter, the
 *     event bus, every cross-module facade).
 *   - A stub `Embedder` that returns deterministic vectors so the
 *     hybrid scorer / vec0 / FTS5 pipeline runs end-to-end without I/O.
 *   - A real `SqliteDatabase` against a temp file (sqlite-vec MUST
 *     load — `:memory:` works for in-memory plus loadExtension on macOS).
 *
 * This helper rebuilds the wiring graph manually, mirroring the steps
 * in `buildContainer` BUT with the stub embedder. Every other wiring
 * helper (encryption, secrets, retrieval, memory, curator, mcp-server,
 * cli) is reused verbatim — the only divergence is `SharedAdapters`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Embedder as RawEmbedder } from "../../../src/shared/application/ports/embedder.port.ts";
import type { EventPublisher } from "../../../src/shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../src/shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../src/shared/application/ports/logger.port.ts";
import { Timestamp } from "../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../src/shared/infrastructure/clock/fake-clock.ts";
import { UuidV7IdGenerator } from "../../../src/shared/infrastructure/id-generator/uuid-v7-id-generator.ts";
import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../../../src/shared/infrastructure/database/sqlite-database.ts";
import { MigrationsRunner } from "../../../src/shared/infrastructure/database/migrations-runner.ts";
import { EmbedderSpec } from "../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { RawEmbedderAdapter } from "../../../src/modules/retrieval/infrastructure/embedder/raw-embedder-adapter.ts";
import { InMemoryEventBus } from "../../../src/composition/event-bus/in-memory-event-bus.ts";
import { EventBusPublisher } from "../../../src/composition/event-bus/event-bus-publisher.ts";
import {
  CheckHealthFacadeAdapter,
  GetContextFacadeAdapter,
  InitializeWorkspaceFacadeAdapter,
  RecallMemoryFacadeAdapter,
  RememberFacadeAdapter,
  TrackTaskFacadeAdapter,
} from "../../../src/composition/facades/mcp-server-facades.ts";
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
  CliSanitizeFacadeAdapter,
  CliStatsFacadeAdapter,
  CliUninstallHookFacadeAdapter,
  CliUnlockWorkspaceFacadeAdapter,
  CliWipeFacadeAdapter,
  PendingAddKeyFacade,
  PendingExportKeyFacade,
  PendingRekeyFacade,
  PendingServerFacade,
} from "../../../src/composition/facades/cli-facades.ts";
import {
  DestroyEncryptionFacadeAdapter,
  InitializeEncryptionFacadeAdapter,
  LockEncryptionFacadeAdapter,
  UnlockEncryptionFacadeAdapter,
} from "../../../src/composition/facades/workspace-encryption-facades.ts";
import { registerMvpTools } from "../../../src/composition/tools/tool-registry-bootstrap.ts";
import { buildCliWiring } from "../../../src/composition/wiring/cli-wiring.ts";
import type { CliWiring } from "../../../src/composition/wiring/cli-wiring.ts";
import { buildCuratorWiring } from "../../../src/composition/wiring/curator-wiring.ts";
import type { CuratorWiring } from "../../../src/composition/wiring/curator-wiring.ts";
import { buildEncryptionWiring } from "../../../src/composition/wiring/encryption-wiring.ts";
import type { EncryptionWiring } from "../../../src/composition/wiring/encryption-wiring.ts";
import { buildMcpServerWiring } from "../../../src/composition/wiring/mcp-server-wiring.ts";
import type { McpServerWiring } from "../../../src/composition/wiring/mcp-server-wiring.ts";
import { buildMemoryWiring } from "../../../src/composition/wiring/memory-wiring.ts";
import type { MemoryWiring } from "../../../src/composition/wiring/memory-wiring.ts";
import { buildRetrievalWiring } from "../../../src/composition/wiring/retrieval-wiring.ts";
import type { RetrievalWiring } from "../../../src/composition/wiring/retrieval-wiring.ts";
import { buildSecretsWiring } from "../../../src/composition/wiring/secrets-wiring.ts";
import type { SecretsWiring } from "../../../src/composition/wiring/secrets-wiring.ts";
import {
  buildDestroyWorkspaceUseCase,
  buildWorkspaceWiring,
} from "../../../src/composition/wiring/workspace-wiring.ts";
import type { WorkspaceWiring } from "../../../src/composition/wiring/workspace-wiring.ts";
import { MemoryWipeFacadeAdapter } from "../../../src/composition/facades/workspace-memory-facades.ts";
import { SqliteWorkspaceStateReader } from "../../../src/composition/queries/sqlite-workspace-state-reader.ts";
import { SilentLogger } from "../../helpers/test-doubles.ts";
import type { DomainEventBus } from "../../../src/composition/event-bus/in-memory-event-bus.ts";
import { StubRawEmbedder } from "./stub-embedder.ts";

/** Anchor instant used as the default `now()` for the `FakeClock`. */
export const ANCHOR_TIME_MS = 1_700_000_000_000;

/** Resolves the absolute path of `code/migrations/`. */
function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "migrations");
}

/**
 * Bag every integration test consumes. Mirrors `Container` from
 * production but exposes the `embedder` as the concrete `StubRawEmbedder`
 * so tests can flip `failNext` and inspect `calls`.
 */
export interface TestContainer {
  readonly logger: Logger;
  readonly clock: FakeClock;
  readonly idGenerator: IdGenerator;
  readonly embedder: StubRawEmbedder;
  readonly database: SqliteDatabase;
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
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
  readonly databasePath: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Construction options for {@link buildTestContainer}.
 */
export interface BuildTestContainerOptions {
  /**
   * When provided, used as the workspace root. Otherwise a fresh
   * `os.tmpdir()`-based directory is created and removed in cleanup.
   */
  readonly workspaceRoot?: string;
  /**
   * When `true`, do NOT call `MigrationsRunner.run` — the test will
   * drive the bootstrap path itself (e.g. via `mem.init`). Defaults
   * to `false`.
   */
  readonly skipMigrations?: boolean;
  /** Override the workspaceId pin. Defaults to a fresh UUID v7. */
  readonly workspaceId?: WorkspaceId;
  /** Override the initial clock. Defaults to {@link ANCHOR_TIME_MS}. */
  readonly initialMs?: number;
  /** Inject an alternative embedder (must satisfy the raw port). */
  readonly embedder?: StubRawEmbedder;
  /** Encryption key resolver. Defaults to "always null" (shared mode). */
  readonly encryptionKeyResolver?: (input: {
    readonly mode: "shared" | "encrypted" | "private";
    readonly databasePath: string;
  }) => Promise<EncryptionKeyBytes | null>;
}

/**
 * Builds the integration-test container.
 *
 *   - Creates a fresh tmp workspace dir under `os.tmpdir()`.
 *   - Opens a real `SqliteDatabase` at `<root>/.recall/recall.db`
 *     and (unless `skipMigrations`) applies every migration shipped in
 *     `code/migrations/`.
 *   - Wires every module via the canonical helpers (`buildSharedAdapters`
 *     is bypassed so we can inject the stub embedder; everything else
 *     is the production helper).
 *   - Returns the {@link TestContainer} plus a `cleanup()` that closes
 *     the DB and removes the tmp dir.
 */
export async function buildTestContainer(
  options: BuildTestContainerOptions = {},
): Promise<TestContainer> {
  const workspaceRoot =
    options.workspaceRoot ??
    fs.mkdtempSync(path.join(os.tmpdir(), "mem-int-"));
  const ownsRoot = options.workspaceRoot === undefined;
  const databaseDir = path.join(workspaceRoot, ".recall");
  // We always need the directory to exist so SqliteDatabase.open does
  // not fail. If `skipMigrations` is true, the test is driving its own
  // workspace bootstrap (e.g. `mem.init`); we rely on the workspace
  // filesystem adapter to (re-)create the directory tree at the right
  // permissions. We still pre-create it here so the placeholder
  // database file can be opened.
  fs.mkdirSync(databaseDir, { recursive: true, mode: 0o700 });
  const databasePath = path.join(databaseDir, "recall.db");
  const migrationsDir = resolveMigrationsDir();

  const logger: Logger = new SilentLogger();
  const clock = new FakeClock({ initialMs: options.initialMs ?? ANCHOR_TIME_MS });
  const idGenerator: IdGenerator = new UuidV7IdGenerator();
  const embedder: StubRawEmbedder = options.embedder ?? new StubRawEmbedder();

  // Open the real database. Note: `loadVectorExtension: true` is the
  // default and is REQUIRED — migration 002 creates a `vec0(...)`
  // virtual table.
  const database = await SqliteDatabase.open({
    path: databasePath,
    logger,
  });

  if (options.skipMigrations !== true) {
    const runner = new MigrationsRunner(logger);
    await runner.run(database, migrationsDir);
  }

  // Event bus + publisher.
  const eventBus = new InMemoryEventBus(logger);
  const eventPublisher: EventPublisher = new EventBusPublisher(eventBus);

  // Encryption module.
  const encryption = buildEncryptionWiring({
    logger,
    clock,
    idGenerator,
    eventPublisher,
    workspaceRoot,
  });

  // Workspace-side cross-module facades.
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

  // Resolver for SQLCipher: defaults to "no key" (shared/private mode).
  const encryptionKeyResolver =
    options.encryptionKeyResolver ??
    ((): Promise<EncryptionKeyBytes | null> => Promise.resolve(null));

  // Workspace.
  const rawEmbedder: RawEmbedder = embedder;
  const workspaceCore = buildWorkspaceWiring({
    logger,
    clock,
    idGenerator,
    embedder: rawEmbedder,
    migrationsDir,
    encryptionKeyResolver,
    initializeEncryptionFacade,
    unlockEncryptionFacade,
    lockEncryptionFacade,
    destroyEncryptionFacade,
  });

  const workspaceId =
    options.workspaceId ?? WorkspaceId.from(idGenerator.generateString());

  // Modules that need the live database.
  const secrets = buildSecretsWiring({
    logger,
    clock,
    idGenerator,
    database,
  });
  const retrievalEmbedder = new RawEmbedderAdapter(embedder);
  const retrieval = buildRetrievalWiring({
    logger,
    clock,
    idGenerator,
    database,
    embedder: retrievalEmbedder,
    workspaceId,
  });
  const memory = buildMemoryWiring({
    logger,
    clock,
    idGenerator,
    eventPublisher,
    database,
    workspaceId,
  });

  // Late-bind the destroy workspace use case now that memory exists
  // (Tarea 5.3 — Bug 2 fix).
  const memoryWipeFacade = new MemoryWipeFacadeAdapter(memory.wipeMemory);
  const destroyWorkspaceUseCase = buildDestroyWorkspaceUseCase({
    workspaceWiring: workspaceCore,
    clock,
    logger,
    eventPublisher,
    memoryWipeFacade,
    lockEncryptionFacade,
  });
  const workspace: WorkspaceWiring = {
    ...workspaceCore,
    destroyWorkspace: destroyWorkspaceUseCase,
  };

  const curator = buildCuratorWiring({
    logger,
    clock,
    idGenerator,
    database,
    workspaceRoot,
    learningRepository: memory.learnings,
    sessionRepository: memory.sessions,
  });

  // mcp-server cross-module facades.
  const defaultEmbedder = EmbedderSpec.create({
    provider: "fastembed",
    model: "BGESmallEN15",
  });
  // Each facade adapter receives the bootstrap-resolved workspaceId
  // so the wire `workspace_id` field can stay optional (B-MCP-1).
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
      new SqliteWorkspaceStateReader(database, logger),
      workspaceRoot,
      "1.0.0",
      "fastembed:BGESmallEN15",
      workspaceId,
    ),
  };

  const mcpServer = buildMcpServerWiring({
    logger,
    clock,
    facades: mcpServerFacades,
    serverInfo: {
      name: "recall-test",
      version: "0.1.0-test",
      protocolVersion: "2024-11-05",
    },
  });
  registerMvpTools({ registry: mcpServer.registry, clock });

  // CLI cross-module facades.
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

  const cleanup = async (): Promise<void> => {
    try {
      database.close();
    } catch {
      // ignore double-close
    }
    if (ownsRoot) {
      // Best-effort cleanup; another container may still hold the dir.
      await fs.promises
        .rm(workspaceRoot, { recursive: true, force: true })
        .catch(() => undefined);
    }
  };

  return {
    logger,
    clock,
    idGenerator,
    embedder,
    database,
    workspace,
    encryption,
    secrets,
    retrieval,
    memory,
    curator,
    mcpServer,
    cli,
    eventBus,
    eventPublisher,
    workspaceId,
    workspaceRoot,
    databasePath,
    cleanup,
  };
}

/**
 * Builds a `Timestamp` at `ANCHOR_TIME_MS + offsetMs`.
 */
export function tsAt(offsetMs: number): Timestamp {
  return Timestamp.fromEpochMs(ANCHOR_TIME_MS + offsetMs);
}

/**
 * Reads the workspaceId from `<root>/.recall/config.json`.
 *
 * Used by tests that need to align the test container's pinned
 * workspaceId with the id minted by the workspace's `initialize`
 * use case (which generates a fresh UUID v7 per the workspace
 * domain rules).
 */
export function readWorkspaceIdFromConfig(workspaceRoot: string): WorkspaceId {
  const raw = fs.readFileSync(
    path.join(workspaceRoot, ".recall", "config.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { workspace_id?: unknown };
  const id = parsed.workspace_id;
  if (typeof id !== "string") {
    throw new Error(`config.json at ${workspaceRoot} has no workspace_id`);
  }
  return WorkspaceId.from(id);
}
