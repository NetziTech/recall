/**
 * Barrel for the CLI module's application-layer ports.
 */

export type { RunCliCommand } from "./in/run-cli-command.port.ts";
export type {
  CommandHandler,
  ErasedCommandHandler,
} from "./in/command-handler.port.ts";

export type {
  WorkspaceModeWire,
  InitializeWorkspaceFacade,
  InitializeWorkspaceFacadeInput,
  InitializeWorkspaceFacadeOutput,
  UnlockWorkspaceFacade,
  UnlockWorkspaceFacadeInput,
  UnlockWorkspaceFacadeOutput,
  LockWorkspaceFacade,
  LockWorkspaceFacadeInput,
  LockWorkspaceFacadeOutput,
  ChangeModeFacade,
  ChangeModeFacadeInput,
  ChangeModeFacadeOutput,
  HealthCheckFacade,
  HealthCheckFacadeInput,
  HealthCheckFacadeOutput,
  HealthCheckFacadeEntry,
} from "./out/workspace-facade.port.ts";

export type {
  ExportKeyFacade,
  ExportKeyFacadeInput,
  ExportKeyFacadeOutput,
  RekeyFacade,
  RekeyFacadeInput,
  RekeyFacadeOutput,
  AddKeyFacade,
  AddKeyFacadeInput,
  AddKeyFacadeOutput,
} from "./out/encryption-facade.port.ts";

export type {
  AuditFacade,
  AuditFacadeInput,
  AuditFacadeOutput,
  AuditFinding,
  SanitizeFacade,
  SanitizeFacadeInput,
  SanitizeFacadeOutput,
  InstallHookFacade,
  InstallHookFacadeInput,
  InstallHookFacadeOutput,
  UninstallHookFacade,
  UninstallHookFacadeInput,
  UninstallHookFacadeOutput,
} from "./out/secrets-facade.port.ts";

export type {
  CuratorRunFacade,
  CuratorRunFacadeInput,
  CuratorRunFacadeOutput,
  CuratorLogFacade,
  CuratorLogFacadeInput,
  CuratorLogFacadeOutput,
  CuratorLogEntry,
} from "./out/curator-facade.port.ts";

export type {
  ImportHandoffFacade,
  ImportHandoffFacadeInput,
  ImportHandoffFacadeOutput,
  ExportFacade,
  ExportFacadeInput,
  ExportFacadeOutput,
  ImportFacade,
  ImportFacadeInput,
  ImportFacadeOutput,
  WipeFacade,
  WipeFacadeInput,
  WipeFacadeOutput,
  StatsFacade,
  StatsFacadeInput,
  StatsFacadeOutput,
  ServerFacade,
  ServerFacadeInput,
  ServerFacadeOutput,
} from "./out/maintenance-facade.port.ts";

export type { Stdout, Stderr, Prompt } from "./out/tty.port.ts";
