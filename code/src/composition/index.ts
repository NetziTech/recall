/**
 * Public surface of `composition/`. The bootstrap entrypoints under
 * `bootstrap/` import from here.
 *
 * The composition root is the only place in the codebase allowed to
 * import from multiple modules at once (per
 * `docs/12-lineamientos-arquitectura.md` §1.5 Regla 4). Everything
 * exported here is wiring or cross-module facade glue.
 *
 * Tarea 4.7: removed the four `Pending*` exports
 * (`EncryptionConfigRepositoryPendingError`,
 * `PendingEncryptionConfigRepository`, `MemoryRepositoryPendingError`,
 * `PendingLearningRepository`, `PendingSessionRepository`,
 * `DestroyEncryptionPendingError`) — the underlying stub files were
 * deleted as the real adapters from Tareas 4.5 and 4.6 supplanted
 * them. The two remaining typed-error exports
 * (`CliFacadeNotImplementedError`, `McpFacadeNotImplementedError`)
 * cover the facades that legitimately stay stubbed (multi-key v0.5,
 * `mcp-memoria server` sub-process, `mem.task get/delete` actions).
 */

export type { Container, ContainerOptions } from "./container.ts";
export { buildContainer } from "./container.ts";

export * from "./event-bus/index.ts";
export { registerMvpTools } from "./tools/tool-registry-bootstrap.ts";

export {
  CliFacadeNotImplementedError,
} from "./facades/cli-facades.ts";
export {
  McpFacadeNotImplementedError,
  WIRE_TO_DOMAIN_LAYER_NAME,
} from "./facades/mcp-server-facades.ts";
