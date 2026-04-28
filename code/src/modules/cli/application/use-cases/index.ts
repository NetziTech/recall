/**
 * Barrel for the CLI module's application-layer use cases.
 *
 * - `RunCliCommandUseCase` is the canonical orchestrator (implements
 *   the `RunCliCommand` driving port).
 * - The handlers under `handlers/` each implement
 *   `CommandHandler<TCommand>` for one entry of the catalog.
 * - `eraseHandler` lets the composition root register concrete
 *   handlers in the use case without an unsafe cast.
 */

export {
  RunCliCommandUseCase,
  eraseHandler,
} from "./run-cli-command.use-case.ts";

export {
  InitCommandHandler,
  ModeCommandHandler,
  UnlockCommandHandler,
  ForgetKeyCommandHandler,
  HealthCommandHandler,
  PassphraseMismatchError,
} from "./handlers/workspace-handlers.ts";

export {
  ExportKeyCommandHandler,
  RekeyCommandHandler,
  AddKeyCommandHandler,
} from "./handlers/encryption-handlers.ts";

export {
  AuditCommandHandler,
  SanitizeCommandHandler,
  InstallHookCommandHandler,
  UninstallHookCommandHandler,
} from "./handlers/secrets-handlers.ts";

export {
  CuratorRunCommandHandler,
  CuratorLogCommandHandler,
} from "./handlers/curator-handlers.ts";

export {
  ImportHandoffCommandHandler,
  ExportCommandHandler,
  ImportCommandHandler,
  WipeCommandHandler,
  StatsCommandHandler,
  ServerCommandHandler,
} from "./handlers/maintenance-handlers.ts";

export { renderEncryptionKeyBanner } from "./handlers/encryption-key-banner.ts";
