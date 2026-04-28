/**
 * Wires the `workspace` module: the filesystem adapter, the marker
 * detector, the database bootstrap (which composes the `SqliteDatabase`
 * + `MigrationsRunner` shared adapters), the embedder probe, and the
 * six driving use cases.
 *
 * Cross-module facades:
 *   - `InitializeEncryptionFacade`, `UnlockEncryptionFacade`,
 *     `LockEncryptionFacade`, `DestroyEncryptionFacade` are wired
 *     from `composition/facades/workspace-encryption-facades.ts`.
 *
 * Migrations directory:
 *   - The bootstrap entrypoint resolves the absolute path to
 *     `code/migrations/` once and passes it down.
 */

import type { Embedder as RawEmbedder } from "../../shared/application/ports/embedder.port.ts";
import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import type { EncryptionKeyBytes } from "../../shared/infrastructure/database/sqlite-database.ts";
import { ChangeModeUseCase } from "../../modules/workspace/application/use-cases/change-mode.use-case.ts";
import { DestroyWorkspaceUseCase } from "../../modules/workspace/application/use-cases/destroy-workspace.use-case.ts";
import { DetectWorkspaceUseCase } from "../../modules/workspace/application/use-cases/detect-workspace.use-case.ts";
import { HealthCheckUseCase } from "../../modules/workspace/application/use-cases/health-check.use-case.ts";
import { InitializeWorkspaceUseCase } from "../../modules/workspace/application/use-cases/initialize-workspace.use-case.ts";
import { LockWorkspaceUseCase } from "../../modules/workspace/application/use-cases/lock-workspace.use-case.ts";
import { UnlockWorkspaceUseCase } from "../../modules/workspace/application/use-cases/unlock-workspace.use-case.ts";
import type { DestroyEncryptionFacade } from "../../modules/workspace/application/ports/out/destroy-encryption-facade.port.ts";
import type { InitializeEncryptionFacade } from "../../modules/workspace/application/ports/out/initialize-encryption-facade.port.ts";
import type { LockEncryptionFacade } from "../../modules/workspace/application/ports/out/lock-encryption-facade.port.ts";
import type { MemoryWipeFacade } from "../../modules/workspace/application/ports/out/memory-wipe-facade.port.ts";
import type { UnlockEncryptionFacade } from "../../modules/workspace/application/ports/out/unlock-encryption-facade.port.ts";
import { MarkerBasedWorkspaceDetector } from "../../modules/workspace/infrastructure/detection/marker-based-workspace-detector.ts";
import { NodeWorkspaceFilesystem } from "../../modules/workspace/infrastructure/filesystem/node-workspace-filesystem.ts";
import { EmbedderPortProbe } from "../../modules/workspace/infrastructure/persistence/embedder-port-probe.ts";
import { SqliteDatabaseBootstrap } from "../../modules/workspace/infrastructure/persistence/sqlite-database-bootstrap.ts";
import { SqliteWorkspaceProjectionWriter } from "../../modules/workspace/infrastructure/persistence/sqlite-workspace-projection-writer.ts";

/**
 * Bag of workspace use cases the rest of composition consumes either
 * directly (CLI handlers, mcp-server facades) or via cross-module
 * facades.
 */
export interface WorkspaceWiring {
  readonly initializeWorkspace: InitializeWorkspaceUseCase;
  readonly detectWorkspace: DetectWorkspaceUseCase;
  readonly unlockWorkspace: UnlockWorkspaceUseCase;
  readonly lockWorkspace: LockWorkspaceUseCase;
  readonly changeMode: ChangeModeUseCase;
  readonly healthCheck: HealthCheckUseCase;
  /**
   * Constructed lazily by `buildDestroyWorkspaceUseCase` AFTER the
   * memory module's wiring exists (the use case needs the
   * `MemoryWipeFacade`). The composition root builds and wires it
   * after `buildMemoryWiring` returns; pre-init flows (where memory
   * is unavailable) use `null`.
   */
  readonly destroyWorkspace: DestroyWorkspaceUseCase | null;
  readonly filesystem: NodeWorkspaceFilesystem;
  readonly databaseBootstrap: SqliteDatabaseBootstrap;
  readonly projectionWriter: SqliteWorkspaceProjectionWriter;
}

/**
 * Resolver function the database bootstrap calls to obtain the
 * encryption key bytes. The composition root supplies a closure that
 * maintains the unlocked-key reference per workspace.
 */
export type EncryptionKeyResolver = (input: {
  readonly mode: "shared" | "encrypted" | "private";
  readonly databasePath: string;
}) => Promise<EncryptionKeyBytes | null>;

export interface WorkspaceWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly embedder: RawEmbedder;
  /** Absolute path to the `code/migrations/` directory. */
  readonly migrationsDir: string;
  /** Resolver for the encrypted-mode key (composition-managed). */
  readonly encryptionKeyResolver: EncryptionKeyResolver;
  /** Cross-module facades wired in `facades/workspace-encryption-facades.ts`. */
  readonly initializeEncryptionFacade: InitializeEncryptionFacade;
  readonly unlockEncryptionFacade: UnlockEncryptionFacade;
  readonly lockEncryptionFacade: LockEncryptionFacade;
  readonly destroyEncryptionFacade: DestroyEncryptionFacade;
}

/**
 * Construction inputs for the lazy
 * {@link buildDestroyWorkspaceUseCase} factory. See its JSDoc.
 */
export interface BuildDestroyWorkspaceUseCaseOptions {
  readonly workspaceWiring: WorkspaceWiring;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly eventPublisher: EventPublisher;
  /** Cross-module facade for the memory module's `WipeMemory` use case. */
  readonly memoryWipeFacade: MemoryWipeFacade;
  /** Encryption-side lock facade reused from the workspace wiring. */
  readonly lockEncryptionFacade: LockEncryptionFacade;
}

/**
 * Builds the workspace wiring with the canonical adapters.
 */
export function buildWorkspaceWiring(
  options: WorkspaceWiringOptions,
): WorkspaceWiring {
  const filesystem = new NodeWorkspaceFilesystem();
  const detector = new MarkerBasedWorkspaceDetector();
  const databaseBootstrap = new SqliteDatabaseBootstrap({
    migrationsDir: options.migrationsDir,
    keyResolver: options.encryptionKeyResolver,
    logger: options.logger,
  });
  const embedderProbe = new EmbedderPortProbe(options.embedder);
  // Projection writer talks directly to SQLite to upsert the
  // `workspace_config` row that the retrieval module reads when
  // assembling the `mem.context` workspace anchor layer (Tarea 5.3 —
  // Bug 1 fix). It reuses the SAME `encryptionKeyResolver` as the
  // bootstrap port so encrypted-mode workspaces unlock cleanly.
  const projectionWriter = new SqliteWorkspaceProjectionWriter({
    keyResolver: options.encryptionKeyResolver,
    logger: options.logger,
  });

  const detectWorkspace = new DetectWorkspaceUseCase(
    detector,
    filesystem,
    options.logger,
  );

  const initializeWorkspace = new InitializeWorkspaceUseCase(
    filesystem,
    databaseBootstrap,
    options.initializeEncryptionFacade,
    projectionWriter,
    options.idGenerator,
    options.clock,
    options.logger,
  );

  const unlockWorkspace = new UnlockWorkspaceUseCase(
    detectWorkspace,
    options.unlockEncryptionFacade,
    options.clock,
    options.logger,
  );

  const lockWorkspace = new LockWorkspaceUseCase(
    detectWorkspace,
    options.lockEncryptionFacade,
    options.clock,
    options.logger,
  );

  const changeMode = new ChangeModeUseCase(
    detectWorkspace,
    filesystem,
    options.initializeEncryptionFacade,
    options.destroyEncryptionFacade,
    projectionWriter,
    options.clock,
    options.logger,
  );

  const healthCheck = new HealthCheckUseCase(
    detectWorkspace,
    filesystem,
    databaseBootstrap,
    embedderProbe,
    options.logger,
  );

  return {
    initializeWorkspace,
    detectWorkspace,
    unlockWorkspace,
    lockWorkspace,
    changeMode,
    healthCheck,
    // The destroy use case is wired lazily AFTER the memory module
    // exists (it needs the `MemoryWipeFacade`). See
    // `buildDestroyWorkspaceUseCase` below; the composition root
    // calls it after `buildMemoryWiring` returns.
    destroyWorkspace: null,
    filesystem,
    databaseBootstrap,
    projectionWriter,
  };
}

/**
 * Lazy factory for `DestroyWorkspaceUseCase`. The use case sits at
 * the boundary between the workspace and memory modules (truncate
 * SQL → remove directory → emit event), so its construction has to
 * wait until both modules are wired. The composition root calls
 * this AFTER `buildMemoryWiring` returns and threads the result
 * back into the wiring bag (replacing the placeholder `null`).
 *
 * Why a separate factory (rather than passing the facade through
 * `WorkspaceWiringOptions`):
 *   - The two-pass pattern keeps the workspace wiring buildable
 *     even in the CLI's pre-init path (`skipDatabase: true`), where
 *     the memory module has no live database connection and the
 *     wipe facade cannot be constructed.
 *   - Avoids a circular dependency between
 *     `buildWorkspaceWiring` and `buildMemoryWiring`.
 */
export function buildDestroyWorkspaceUseCase(
  options: BuildDestroyWorkspaceUseCaseOptions,
): DestroyWorkspaceUseCase {
  return new DestroyWorkspaceUseCase(
    options.workspaceWiring.detectWorkspace,
    options.memoryWipeFacade,
    options.lockEncryptionFacade,
    options.workspaceWiring.filesystem,
    options.eventPublisher,
    options.clock,
    options.logger,
  );
}
