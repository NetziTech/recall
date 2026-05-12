import type { CommandNameValue } from "../../domain/value-objects/command-name.ts";

/**
 * DTO carrying the parsed shape of a CLI invocation as produced by
 * the argv parser adapter. Each variant is keyed on the
 * `CommandNameValue` literal so the application layer can dispatch
 * to the matching use case via a switch / lookup.
 *
 * Why a discriminated union and not 20 separate ports:
 *   - The CLI command catalog (`docs/07-instalacion.md` §7) is small
 *     and stable. A single `RunCliCommand` port keyed on the
 *     discriminator gives us:
 *       1. One place where the dispatch happens (the
 *          `RunCliCommandUseCase`).
 *       2. One Zod schema per command in the parser adapter.
 *       3. No combinatorial port-explosion in `application/ports/in/`.
 *     The trade-off (20 case branches) is more readable than 20
 *     separately-imported ports.
 *   - SOLID-ISP is preserved at the *use case* level: each command
 *     handler is its own class implementing the same one-method
 *     port (`CommandHandler`).
 *
 * Field shape rules:
 *   - Every variant carries `workspacePath: string | null`. Null
 *     means "auto-detect from cwd"; the handler is responsible for
 *     calling `DetectWorkspace` when null. Non-null is the
 *     `--workspace <path>` user supplied.
 *   - Every variant carries `nonInteractive: boolean`. The CLI
 *     defaults to interactive (allows prompts); flipping the flag
 *     forces the command to fail when a prompt would otherwise be
 *     issued (CI / scripts).
 *   - String fields are RAW user input. Validation against domain
 *     VOs happens in the use case, not in the parser.
 */

interface CliInvocationCommon {
  readonly workspacePath: string | null;
  readonly nonInteractive: boolean;
}

export interface CliInitInvocation extends CliInvocationCommon {
  readonly command: "init";
  readonly mode: "shared" | "encrypted" | "private" | null;
  readonly displayName: string | null;
}

export interface CliModeInvocation extends CliInvocationCommon {
  readonly command: "mode";
  readonly newMode: "shared" | "encrypted" | "private";
}

export interface CliUnlockInvocation extends CliInvocationCommon {
  readonly command: "unlock";
  /** When provided, the passphrase came from a non-interactive flag. */
  readonly passphrase: string | null;
}

export interface CliForgetKeyInvocation extends CliInvocationCommon {
  readonly command: "forget-key";
}

export interface CliExportKeyInvocation extends CliInvocationCommon {
  readonly command: "export-key";
}

export interface CliRekeyInvocation extends CliInvocationCommon {
  readonly command: "rekey";
  /**
   * Optional human-readable identifier for the freshly minted
   * envelope created during the rotation (ADR-005 Q2). The CLI
   * surface accepts `--label <name>`; the parser sets the field to
   * `null` when the flag is absent.
   */
  readonly label: string | null;
}

export interface CliAddKeyInvocation extends CliInvocationCommon {
  readonly command: "add-key";
  readonly label: string | null;
}

export interface CliAuditInvocation extends CliInvocationCommon {
  readonly command: "audit";
  readonly checkSecrets: boolean;
  readonly strict: boolean;
}

export interface CliSanitizeInvocation extends CliInvocationCommon {
  readonly command: "sanitize";
  readonly entryId: string;
}

export interface CliCuratorRunInvocation extends CliInvocationCommon {
  readonly command: "curator-run";
  readonly dryRun: boolean;
}

export interface CliCuratorLogInvocation extends CliInvocationCommon {
  readonly command: "curator-log";
  readonly last: number | null;
}

/**
 * `recall reset-queue [--threshold <n>]` — clears `attempts` on every
 * embedding-queue row at or above the threshold (default 5) so the
 * worker re-tries permanent failures. Recovery for B-MCP-7
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 */
export interface CliResetQueueInvocation extends CliInvocationCommon {
  readonly command: "reset-queue";
  /** Defaults to 5 (the worker's `MAX_ATTEMPTS`). */
  readonly threshold: number | null;
}

export interface CliImportHandoffInvocation extends CliInvocationCommon {
  readonly command: "import-handoff";
  readonly handoffPath: string;
}

export interface CliExportInvocation extends CliInvocationCommon {
  readonly command: "export";
  readonly outputPath: string;
}

export interface CliImportInvocation extends CliInvocationCommon {
  readonly command: "import";
  readonly inputPath: string;
}

export interface CliWipeInvocation extends CliInvocationCommon {
  readonly command: "wipe";
  readonly confirm: boolean;
}

export interface CliInstallHookInvocation extends CliInvocationCommon {
  readonly command: "install-hook";
}

export interface CliUninstallHookInvocation extends CliInvocationCommon {
  readonly command: "uninstall-hook";
}

export interface CliStatsInvocation extends CliInvocationCommon {
  readonly command: "stats";
}

export interface CliHealthInvocation extends CliInvocationCommon {
  readonly command: "health";
}

export interface CliServerInvocation extends CliInvocationCommon {
  readonly command: "server";
}

export type CliInvocation =
  | CliInitInvocation
  | CliModeInvocation
  | CliUnlockInvocation
  | CliForgetKeyInvocation
  | CliExportKeyInvocation
  | CliRekeyInvocation
  | CliAddKeyInvocation
  | CliAuditInvocation
  | CliSanitizeInvocation
  | CliCuratorRunInvocation
  | CliCuratorLogInvocation
  | CliResetQueueInvocation
  | CliImportHandoffInvocation
  | CliExportInvocation
  | CliImportInvocation
  | CliWipeInvocation
  | CliInstallHookInvocation
  | CliUninstallHookInvocation
  | CliStatsInvocation
  | CliHealthInvocation
  | CliServerInvocation;

/**
 * Compile-time exhaustiveness sentinel: if the command catalog is
 * extended in `command-name.ts` and a new branch is not added to the
 * union above, this assertion will fail to typecheck.
 */
type _Exhaustive = CliInvocation["command"] extends CommandNameValue
  ? CommandNameValue extends CliInvocation["command"]
    ? true
    : false
  : false;

/**
 * Compile-time guard: if `_Exhaustive` becomes false (i.e. the
 * union and the catalog drift), this assignment refuses to typecheck.
 *
 * Casting via a typed `const` assignment is enough: the type system
 * surfaces the mismatch on every `npm run typecheck`.
 */
export const _CLI_INVOCATION_CATALOG_IS_EXHAUSTIVE: _Exhaustive = true;
