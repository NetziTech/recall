/**
 * Public surface of `modules/mcp-server/application/use-cases/`.
 *
 * Re-exports the six MVP protocol-facade use cases so the composition
 * root can wire them to their `*.port.ts` outputs in one place.
 */

export { CheckHealthUseCase } from "./check-health.use-case.ts";
export { GetContextUseCase } from "./get-context.use-case.ts";
export { InitWorkspaceUseCase } from "./init-workspace.use-case.ts";
export { RecallMemoryUseCase } from "./recall-memory.use-case.ts";
export { RememberUseCase } from "./remember.use-case.ts";
export { TrackTaskUseCase } from "./track-task.use-case.ts";
