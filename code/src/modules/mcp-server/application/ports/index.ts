/**
 * Public surface of `modules/mcp-server/application/ports/`.
 *
 * Re-exports input (driving) ports — what the application layer
 * promises to do for the JSON-RPC adapter — and output (driven)
 * ports — what the application layer requires the composition root
 * to wire from neighbouring modules.
 *
 * The split between `in/` and `out/` mirrors the canonical hexagonal
 * naming convention from `docs/12-lineamientos-arquitectura.md` §1.3
 * and keeps the dependency arrows visible at the import path level.
 */

export type { CheckHealth } from "./in/check-health.port.ts";
export type { GetContext } from "./in/get-context.port.ts";
export type { InitWorkspace } from "./in/init-workspace.port.ts";
export type { RecallMemory } from "./in/recall-memory.port.ts";
export type { Remember } from "./in/remember.port.ts";
export type { TrackTask } from "./in/track-task.port.ts";

export type { CheckHealthFacade } from "./out/check-health-facade.port.ts";
export type { GetContextFacade } from "./out/get-context-facade.port.ts";
export type { InitializeWorkspaceFacade } from "./out/initialize-workspace-facade.port.ts";
export type { RecallMemoryFacade } from "./out/recall-memory-facade.port.ts";
export type { RememberFacade } from "./out/remember-facade.port.ts";
export type { TrackTaskFacade } from "./out/track-task-facade.port.ts";
