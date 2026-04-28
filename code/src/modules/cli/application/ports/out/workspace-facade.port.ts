/**
 * Driven (output) facade ports toward the workspace module's use cases.
 *
 * The CLI module cannot import workspace-domain types directly per
 * `docs/12 §1.5`. The composition root wires these facades to the
 * matching workspace use cases.
 *
 * Outputs use plain primitive shapes (no domain VOs) so the CLI's
 * formatters can render them without reaching into another module's
 * domain.
 */

export type WorkspaceModeWire = "shared" | "encrypted" | "private";

export interface InitializeWorkspaceFacadeInput {
  readonly rootPath: string;
  readonly mode: WorkspaceModeWire;
  readonly displayName: string;
  readonly passphrase: string | null;
}

export interface InitializeWorkspaceFacadeOutput {
  readonly workspaceId: string;
  readonly mode: WorkspaceModeWire;
  readonly wasCreated: boolean;
}

export interface InitializeWorkspaceFacade {
  initialize(
    input: InitializeWorkspaceFacadeInput,
  ): Promise<InitializeWorkspaceFacadeOutput>;
}

export interface UnlockWorkspaceFacadeInput {
  readonly rootPath: string;
  readonly passphrase: string | null;
}

export interface UnlockWorkspaceFacadeOutput {
  readonly workspaceId: string;
  readonly wasUnlocked: boolean;
  readonly mode: WorkspaceModeWire;
}

export interface UnlockWorkspaceFacade {
  unlock(
    input: UnlockWorkspaceFacadeInput,
  ): Promise<UnlockWorkspaceFacadeOutput>;
}

export interface LockWorkspaceFacadeInput {
  readonly rootPath: string;
}

export interface LockWorkspaceFacadeOutput {
  readonly workspaceId: string;
  readonly wasLocked: boolean;
}

export interface LockWorkspaceFacade {
  lock(input: LockWorkspaceFacadeInput): Promise<LockWorkspaceFacadeOutput>;
}

export interface ChangeModeFacadeInput {
  readonly rootPath: string;
  readonly newMode: WorkspaceModeWire;
  readonly passphrase: string | null;
}

export interface ChangeModeFacadeOutput {
  readonly workspaceId: string;
  readonly newMode: WorkspaceModeWire;
}

export interface ChangeModeFacade {
  change(input: ChangeModeFacadeInput): Promise<ChangeModeFacadeOutput>;
}

export interface HealthCheckFacadeInput {
  readonly rootPath: string;
}

export interface HealthCheckFacadeEntry {
  readonly id: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly message: string;
}

export interface HealthCheckFacadeOutput {
  readonly checks: readonly HealthCheckFacadeEntry[];
  readonly healthy: boolean;
}

export interface HealthCheckFacade {
  check(input: HealthCheckFacadeInput): Promise<HealthCheckFacadeOutput>;
}
