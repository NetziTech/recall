/**
 * Barrel for the workspace module's application-layer ports.
 *
 * Driving (input) ports — orchestrated by the CLI / MCP server.
 * Driven (output) ports — implemented by infrastructure adapters and
 *   the composition root's facade wiring.
 */

export type {
  InitializeWorkspace,
  InitializeWorkspaceInput,
  InitializeWorkspaceOutput,
} from "./in/initialize-workspace.port.ts";

export type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "./in/detect-workspace.port.ts";

export type {
  UnlockWorkspace,
  UnlockWorkspaceInput,
  UnlockWorkspaceOutput,
} from "./in/unlock-workspace.port.ts";

export type {
  LockWorkspace,
  LockWorkspaceInput,
  LockWorkspaceOutput,
} from "./in/lock-workspace.port.ts";

export type {
  ChangeMode,
  ChangeModeInput,
  ChangeModeOutput,
} from "./in/change-mode.port.ts";

export type {
  HealthCheck,
  HealthCheckInput,
  HealthCheckOutput,
  HealthCheckEntry,
  HealthCheckStatus,
} from "./in/health-check.port.ts";

export type {
  WorkspaceFilesystem,
  PersistedWorkspaceConfig,
} from "./out/workspace-filesystem.port.ts";

export type { InitializeEncryptionFacade } from "./out/initialize-encryption-facade.port.ts";

export type {
  UnlockEncryptionFacade,
  UnlockEncryptionFacadeOutcome,
} from "./out/unlock-encryption-facade.port.ts";

export type {
  LockEncryptionFacade,
  LockEncryptionFacadeOutcome,
} from "./out/lock-encryption-facade.port.ts";

export type {
  DestroyEncryptionFacade,
  DestroyEncryptionTargetMode,
} from "./out/destroy-encryption-facade.port.ts";

export type {
  DatabaseBootstrap,
  DatabaseBootstrapInput,
  DatabaseBootstrapResult,
  DatabaseProbeResult,
} from "./out/database-bootstrap.port.ts";

export type {
  EmbedderProbe,
  EmbedderProbeOutcome,
} from "./out/embedder-probe.port.ts";

export type {
  DestroyWorkspace,
  DestroyWorkspaceInput,
  DestroyWorkspaceOutput,
} from "./in/destroy-workspace.port.ts";

export type {
  WorkspaceProjectionWriter,
  UpsertWorkspaceConfigInput,
} from "./out/workspace-projection-writer.port.ts";

export type {
  MemoryWipeFacade,
  MemoryWipeFacadeOutcome,
} from "./out/memory-wipe-facade.port.ts";
