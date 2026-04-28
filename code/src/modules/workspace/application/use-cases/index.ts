/**
 * Barrel for the workspace module's application-layer use cases.
 *
 * Concrete classes that implement the driving ports defined under
 * `application/ports/in/`. The composition root wires each one with
 * its driven-port dependencies.
 */

export { InitializeWorkspaceUseCase } from "./initialize-workspace.use-case.ts";
export { DetectWorkspaceUseCase } from "./detect-workspace.use-case.ts";
export { UnlockWorkspaceUseCase } from "./unlock-workspace.use-case.ts";
export { LockWorkspaceUseCase } from "./lock-workspace.use-case.ts";
export { ChangeModeUseCase } from "./change-mode.use-case.ts";
export { HealthCheckUseCase } from "./health-check.use-case.ts";
export { DestroyWorkspaceUseCase } from "./destroy-workspace.use-case.ts";
