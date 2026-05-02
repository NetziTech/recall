/**
 * Wires the `cli` module: the parser, the command handlers (one per
 * `CommandHandler<T>`), the orchestrator (`RunCliCommandUseCase`),
 * and the entrypoint adapter.
 *
 * Every handler receives the matching cross-module facade (wired in
 * `composition/facades/cli-facades.ts`).
 */

import type { Logger } from "../../shared/application/ports/logger.port.ts";
import {
  AddKeyCommandHandler,
  AuditCommandHandler,
  CuratorLogCommandHandler,
  CuratorRunCommandHandler,
  ExportCommandHandler,
  ExportKeyCommandHandler,
  ForgetKeyCommandHandler,
  HealthCommandHandler,
  ImportCommandHandler,
  ImportHandoffCommandHandler,
  InitCommandHandler,
  InstallHookCommandHandler,
  ModeCommandHandler,
  RekeyCommandHandler,
  ResetQueueCommandHandler,
  RunCliCommandUseCase,
  SanitizeCommandHandler,
  ServerCommandHandler,
  StatsCommandHandler,
  UninstallHookCommandHandler,
  UnlockCommandHandler,
  WipeCommandHandler,
  eraseHandler,
} from "../../modules/cli/application/use-cases/index.ts";
import type { ErasedCommandHandler } from "../../modules/cli/application/ports/in/command-handler.port.ts";
import type {
  AddKeyFacade,
  ExportKeyFacade,
  RekeyFacade,
} from "../../modules/cli/application/ports/out/encryption-facade.port.ts";
import type {
  ExportFacade,
  ImportFacade,
  ImportHandoffFacade,
  ServerFacade,
  StatsFacade,
  WipeFacade,
} from "../../modules/cli/application/ports/out/maintenance-facade.port.ts";
import type {
  AuditFacade,
  InstallHookFacade,
  SanitizeFacade,
  UninstallHookFacade,
} from "../../modules/cli/application/ports/out/secrets-facade.port.ts";
import type {
  CuratorLogFacade,
  CuratorRunFacade,
} from "../../modules/cli/application/ports/out/curator-facade.port.ts";
import type { ResetQueueFacade } from "../../modules/cli/application/ports/out/embedding-queue-facade.port.ts";
import type {
  ChangeModeFacade,
  HealthCheckFacade,
  InitializeWorkspaceFacade as CliInitializeWorkspaceFacade,
  LockWorkspaceFacade,
  UnlockWorkspaceFacade,
} from "../../modules/cli/application/ports/out/workspace-facade.port.ts";
import type {
  Prompt,
  Stderr,
  Stdout,
} from "../../modules/cli/application/ports/out/tty.port.ts";
import { CommanderCliParser } from "../../modules/cli/infrastructure/parser/commander-cli-parser.ts";
import {
  NodeReadlinePrompt,
  ProcessStderr,
  ProcessStdout,
} from "../../modules/cli/infrastructure/output/process-tty.ts";
import { CliEntrypoint } from "../../modules/cli/infrastructure/runtime/cli-entrypoint.ts";

/**
 * Bag of every adapter the bootstrap entrypoint glues together. The
 * entrypoint (`bootstrap/cli-entrypoint.ts`) calls `entrypoint.run(argv)`
 * and forwards the exit code to `process.exit`.
 */
export interface CliWiring {
  readonly parser: CommanderCliParser;
  readonly entrypoint: CliEntrypoint;
  readonly stdout: Stdout;
  readonly stderr: Stderr;
  readonly prompt: Prompt;
}

export interface CliFacadesBag {
  readonly initializeWorkspace: CliInitializeWorkspaceFacade;
  readonly unlockWorkspace: UnlockWorkspaceFacade;
  readonly lockWorkspace: LockWorkspaceFacade;
  readonly changeMode: ChangeModeFacade;
  readonly health: HealthCheckFacade;

  readonly exportKey: ExportKeyFacade;
  readonly rekey: RekeyFacade;
  readonly addKey: AddKeyFacade;

  readonly audit: AuditFacade;
  readonly sanitize: SanitizeFacade;
  readonly installHook: InstallHookFacade;
  readonly uninstallHook: UninstallHookFacade;

  readonly curatorRun: CuratorRunFacade;
  readonly curatorLog: CuratorLogFacade;
  readonly resetQueue: ResetQueueFacade;

  readonly importHandoff: ImportHandoffFacade;
  readonly export: ExportFacade;
  readonly import: ImportFacade;
  readonly wipe: WipeFacade;
  readonly stats: StatsFacade;
  readonly server: ServerFacade;
}

export interface CliWiringOptions {
  readonly logger: Logger;
  readonly facades: CliFacadesBag;
}

/**
 * Builds the CLI wiring. Each handler is `eraseHandler`-wrapped so
 * the runner stores them in a `Map<CommandName, ErasedCommandHandler>`.
 */
export function buildCliWiring(options: CliWiringOptions): CliWiring {
  const stdout: Stdout = new ProcessStdout();
  const stderr: Stderr = new ProcessStderr();
  const prompt: Prompt = new NodeReadlinePrompt();

  const handlers: readonly ErasedCommandHandler[] = [
    eraseHandler(
      new InitCommandHandler(
        options.facades.initializeWorkspace,
        prompt,
        options.logger,
      ),
    ),
    eraseHandler(
      new ModeCommandHandler(
        options.facades.changeMode,
        prompt,
        options.logger,
      ),
    ),
    eraseHandler(
      new UnlockCommandHandler(
        options.facades.unlockWorkspace,
        prompt,
        options.logger,
      ),
    ),
    eraseHandler(
      new ForgetKeyCommandHandler(options.facades.lockWorkspace, options.logger),
    ),
    eraseHandler(
      new HealthCommandHandler(options.facades.health, options.logger),
    ),

    eraseHandler(
      new ExportKeyCommandHandler(options.facades.exportKey, options.logger),
    ),
    eraseHandler(
      new RekeyCommandHandler(options.facades.rekey, prompt, options.logger),
    ),
    eraseHandler(
      new AddKeyCommandHandler(options.facades.addKey, prompt, options.logger),
    ),

    eraseHandler(new AuditCommandHandler(options.facades.audit, options.logger)),
    eraseHandler(
      new SanitizeCommandHandler(options.facades.sanitize, options.logger),
    ),
    eraseHandler(
      new InstallHookCommandHandler(
        options.facades.installHook,
        options.logger,
      ),
    ),
    eraseHandler(
      new UninstallHookCommandHandler(
        options.facades.uninstallHook,
        options.logger,
      ),
    ),

    eraseHandler(
      new CuratorRunCommandHandler(options.facades.curatorRun, options.logger),
    ),
    eraseHandler(
      new CuratorLogCommandHandler(options.facades.curatorLog, options.logger),
    ),
    eraseHandler(
      new ResetQueueCommandHandler(
        options.facades.resetQueue,
        options.logger,
      ),
    ),

    eraseHandler(
      new ImportHandoffCommandHandler(
        options.facades.importHandoff,
        options.logger,
      ),
    ),
    eraseHandler(
      new ExportCommandHandler(options.facades.export, options.logger),
    ),
    eraseHandler(
      new ImportCommandHandler(options.facades.import, options.logger),
    ),
    eraseHandler(
      new WipeCommandHandler(options.facades.wipe, prompt, options.logger),
    ),
    eraseHandler(
      new StatsCommandHandler(options.facades.stats, options.logger),
    ),
    eraseHandler(
      new ServerCommandHandler(options.facades.server, options.logger),
    ),
  ];

  const parser = new CommanderCliParser();
  const runner = new RunCliCommandUseCase(handlers, options.logger);
  const entrypoint = new CliEntrypoint(parser, runner, stdout, stderr, options.logger);

  return { parser, entrypoint, stdout, stderr, prompt };
}
