/**
 * Barrel for the workspace module's infrastructure adapters.
 */

export { NodeWorkspaceFilesystem } from "./filesystem/node-workspace-filesystem.ts";
export { MarkerBasedWorkspaceDetector } from "./detection/marker-based-workspace-detector.ts";
export {
  SqliteDatabaseBootstrap,
  type SqliteDatabaseBootstrapOptions,
} from "./persistence/sqlite-database-bootstrap.ts";
export { EmbedderPortProbe } from "./persistence/embedder-port-probe.ts";
export {
  SqliteWorkspaceProjectionWriter,
  type SqliteWorkspaceProjectionWriterOptions,
} from "./persistence/sqlite-workspace-projection-writer.ts";
export {
  WorkspaceInfrastructureError,
  type WorkspaceInfrastructureErrorCode,
} from "./errors/workspace-infrastructure-error.ts";
