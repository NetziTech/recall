import { Command } from "commander";

import { HelpRequestedSignal } from "../../domain/errors/help-requested-signal.ts";
import { InvalidCommandArgsError } from "../../domain/errors/invalid-command-args-error.ts";
import { UnknownCommandError } from "../../domain/errors/unknown-command-error.ts";
import type { CliInvocation } from "../../application/dtos/cli-invocation.dto.ts";

/**
 * Argv parser adapter built on top of `commander` (already in the
 * runtime deps — see `package.json`).
 *
 * Why commander and not a hand-rolled parser:
 *   - The catalog has 20 commands with mixed positionals + options.
 *     A hand-rolled parser would re-implement a quarter of commander
 *     for no benefit.
 *   - Commander's "subcommand" model maps 1:1 to the catalog and
 *     produces help output that matches the docs.
 *
 * Design rules:
 *   - The parser produces `CliInvocation` (the application DTO). It
 *     does NOT call into use cases or facades.
 *   - Errors raised here are CLI-domain errors
 *     (`UnknownCommandError`, `InvalidCommandArgsError`) so the
 *     entrypoint adapter maps them uniformly to exit codes.
 *   - The parser does NOT exit the process. We disable commander's
 *     `exitOverride` so usage errors come back as thrown exceptions
 *     for the entrypoint to handle.
 *
 * Non-interactive mode:
 *   The `--non-interactive` flag is a global option; every command
 *   inherits it. The flag flips the per-invocation `nonInteractive`
 *   field so handlers can refuse interactive prompts.
 */
export class CommanderCliParser {
  public parse(argv: readonly string[]): CliInvocation {
    const program = new Command()
      .name("recall")
      .description(
        "MCP server for project-scoped, self-curated memory with hybrid search.",
      )
      .option("--non-interactive", "do not prompt the user under any circumstance", false)
      .option(
        "--workspace <path>",
        "absolute path to the host project (defaults to cwd auto-detect)",
      )
      // Disable commander's process.exit calls so the entrypoint owns
      // the exit-code policy.
      .exitOverride();

    // Mutable holder updated by Commander's `.action()` callbacks.
    // Typed as a one-element box so TS / typescript-eslint can see
    // that the value may legitimately remain `null` after `parse()`
    // (no command matched, --help, etc.).
    const captured: { value: CliInvocation | null } = { value: null };

    // Helper: pulls --workspace and --non-interactive from the
    // command's own opts() merging in any inherited from the
    // top-level program.
    const commonOpts = (cmd: Command): {
      workspacePath: string | null;
      nonInteractive: boolean;
    } => {
      const root = cmd.optsWithGlobals<{
        workspace?: string;
        nonInteractive?: boolean;
      }>();
      return {
        workspacePath: typeof root.workspace === "string" ? root.workspace : null,
        nonInteractive: root.nonInteractive === true,
      };
    };

    program
      .command("init")
      .description("initialise a workspace under <path>/.recall/")
      .option("--mode <mode>", "shared|encrypted|private")
      .option("--display-name <name>", "human-readable workspace name")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ mode?: string; displayName?: string }>();
        const common = commonOpts(cmd);
        captured.value = {
          command: "init",
          ...common,
          mode: parseModeOrNull(opts.mode),
          displayName: typeof opts.displayName === "string" ? opts.displayName : null,
        };
      });

    program
      .command("mode <new-mode>")
      .description("change the workspace privacy mode")
      .action((newMode: string, _opts: unknown, cmd: Command) => {
        const common = commonOpts(cmd);
        captured.value = {
          command: "mode",
          ...common,
          newMode: requireMode(newMode),
        };
      });

    program
      .command("unlock")
      .description("unlock an encrypted workspace and cache the key in HOME")
      .option("--passphrase <value>", "non-interactive passphrase (avoid in shell history)")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ passphrase?: string }>();
        const common = commonOpts(cmd);
        captured.value = {
          command: "unlock",
          ...common,
          passphrase: typeof opts.passphrase === "string" ? opts.passphrase : null,
        };
      });

    program
      .command("forget-key")
      .description("drop the cached key for an encrypted workspace")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "forget-key", ...commonOpts(cmd) };
      });

    program
      .command("export-key")
      .description("re-print the encryption key (workspace must be unlocked)")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "export-key", ...commonOpts(cmd) };
      });

    program
      .command("rekey")
      .description("generate a fresh master key and re-cipher all envelopes (v0.5+)")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "rekey", ...commonOpts(cmd) };
      });

    program
      .command("add-key")
      .description("add a secondary key envelope (multi-key, v0.5+)")
      .option("--label <label>", "optional human-readable label")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ label?: string }>();
        captured.value = {
          command: "add-key",
          ...commonOpts(cmd),
          label: typeof opts.label === "string" ? opts.label : null,
        };
      });

    program
      .command("audit")
      .description("audit the persisted memory (cross-checks, secrets)")
      .option("--check-secrets", "include secret-pattern detection", false)
      .option("--strict", "exit with secretDetected (7) when criticals exist", false)
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ checkSecrets?: boolean; strict?: boolean }>();
        captured.value = {
          command: "audit",
          ...commonOpts(cmd),
          checkSecrets: opts.checkSecrets === true,
          strict: opts.strict === true,
        };
      });

    program
      .command("sanitize")
      .description("redact a previously-recorded entry by id")
      .requiredOption("--entry-id <id>", "id of the offending entry")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ entryId: string }>();
        captured.value = {
          command: "sanitize",
          ...commonOpts(cmd),
          entryId: opts.entryId,
        };
      });

    program
      .command("curator-run")
      .description("run the curator pass (decay, consolidation, prune)")
      .option("--dry-run", "compute the curator deltas without applying them", false)
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ dryRun?: boolean }>();
        captured.value = {
          command: "curator-run",
          ...commonOpts(cmd),
          dryRun: opts.dryRun === true,
        };
      });

    program
      .command("curator-log")
      .description("list the most recent curator runs")
      .option("--last <n>", "number of entries to show")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ last?: string }>();
        captured.value = {
          command: "curator-log",
          ...commonOpts(cmd),
          last: parsePositiveIntegerOrNull(opts.last, "--last"),
        };
      });

    program
      .command("reset-queue")
      .description(
        "reset perma-failed embedding queue rows so the worker re-tries them (B-MCP-7 recovery)",
      )
      .option(
        "--threshold <n>",
        "minimum attempts to reset (default 5 = the worker's MAX_ATTEMPTS)",
      )
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ threshold?: string }>();
        captured.value = {
          command: "reset-queue",
          ...commonOpts(cmd),
          threshold: parsePositiveIntegerOrNull(opts.threshold, "--threshold"),
        };
      });

    program
      .command("import-handoff")
      .description("seed memory from a legacy HANDOFF.md")
      .requiredOption("--handoff <file>", "path to the HANDOFF.md file")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ handoff: string }>();
        captured.value = {
          command: "import-handoff",
          ...commonOpts(cmd),
          handoffPath: opts.handoff,
        };
      });

    program
      .command("export")
      .description("export the workspace to a JSON file")
      .requiredOption("--output <file>", "destination JSON path")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ output: string }>();
        captured.value = {
          command: "export",
          ...commonOpts(cmd),
          outputPath: opts.output,
        };
      });

    program
      .command("import")
      .description("import a previously-exported JSON file")
      .requiredOption("--input <file>", "source JSON path")
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ input: string }>();
        captured.value = {
          command: "import",
          ...commonOpts(cmd),
          inputPath: opts.input,
        };
      });

    program
      .command("wipe")
      .description("remove .recall/ from the host project")
      .option("--confirm", "skip the interactive WIPE confirmation", false)
      .action((_opts: unknown, cmd: Command) => {
        const opts = cmd.opts<{ confirm?: boolean }>();
        captured.value = {
          command: "wipe",
          ...commonOpts(cmd),
          confirm: opts.confirm === true,
        };
      });

    program
      .command("install-hook")
      .description("install the optional pre-commit hook")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "install-hook", ...commonOpts(cmd) };
      });

    program
      .command("uninstall-hook")
      .description("remove the optional pre-commit hook")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "uninstall-hook", ...commonOpts(cmd) };
      });

    program
      .command("stats")
      .description("show structured stats about the workspace")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "stats", ...commonOpts(cmd) };
      });

    program
      .command("health")
      .description("run health probes against the workspace")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "health", ...commonOpts(cmd) };
      });

    program
      .command("server")
      .description("launch the MCP stdio server (invoked by the MCP client)")
      .action((_opts: unknown, cmd: Command) => {
        captured.value = { command: "server", ...commonOpts(cmd) };
      });

    try {
      // Commander mutates argv inputs by skipping the first two
      // entries (node binary + script). We pass the slice the entry
      // adapter already prepared (positional args only).
      program.parse(argv, { from: "user" });
    } catch (err: unknown) {
      throw mapCommanderError(err, argv);
    }

    const result = captured.value;
    if (result === null) {
      // Commander didn't dispatch any command — typically `--help` or
      // invalid usage. We surface as `UnknownCommandError`.
      throw new UnknownCommandError(argv.join(" "));
    }
    return result;
  }
}

function parseModeOrNull(
  raw: string | undefined,
): "shared" | "encrypted" | "private" | null {
  if (raw === undefined) return null;
  if (raw === "shared" || raw === "encrypted" || raw === "private") return raw;
  throw new InvalidCommandArgsError(
    `--mode must be one of "shared" | "encrypted" | "private" (got: "${raw}")`,
    { commandName: "init", field: "mode" },
  );
}

function requireMode(raw: string): "shared" | "encrypted" | "private" {
  if (raw === "shared" || raw === "encrypted" || raw === "private") return raw;
  throw new InvalidCommandArgsError(
    `mode must be one of "shared" | "encrypted" | "private" (got: "${raw}")`,
    { commandName: "mode", field: "newMode" },
  );
}

function parsePositiveIntegerOrNull(
  raw: string | undefined,
  fieldLabel: string,
): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidCommandArgsError(
      `${fieldLabel} must be a positive integer (got: "${raw}")`,
      { commandName: "curator-log", field: "last" },
    );
  }
  return n;
}

function mapCommanderError(err: unknown, argv: readonly string[]): Error {
  if (typeof err === "object" && err !== null) {
    const candidate = err as { readonly code?: unknown; readonly message?: unknown };
    // Help / version exit codes from Commander.
    //
    // When `.exitOverride()` is active, Commander's help / version
    // helpers DO write the requested output (to stdout for help, also
    // to stdout for version) and THEN throw a `CommanderError` to
    // abort the dispatch. The thrown shape carries one of three
    // codes — `commander.helpDisplayed` (after `--help`),
    // `commander.help` (after the implicit help on `recall` with no
    // args), and `commander.version` (after `--version`).
    //
    // We translate every one of these into a `HelpRequestedSignal`
    // so the entrypoint adapter can short-circuit to exit 0 without
    // logging a misleading "CLI parser threw unexpectedly" ERROR
    // record (B-CLI-1). The signal is NOT a `CliDomainError`; the
    // entrypoint's signal check sits before the domain-error branch.
    if (
      candidate.code === "commander.helpDisplayed" ||
      candidate.code === "commander.help" ||
      candidate.code === "commander.version"
    ) {
      const message =
        typeof candidate.message === "string"
          ? candidate.message
          : "(outputHelp)";
      return new HelpRequestedSignal(message);
    }
    if (candidate.code === "commander.unknownCommand") {
      return new UnknownCommandError(argv.join(" "));
    }
    if (
      candidate.code === "commander.missingMandatoryOptionValue" ||
      candidate.code === "commander.missingArgument" ||
      candidate.code === "commander.optionMissingArgument" ||
      candidate.code === "commander.invalidArgument"
    ) {
      const message =
        typeof candidate.message === "string"
          ? candidate.message
          : "missing or invalid argument";
      return new InvalidCommandArgsError(
        message,
        { commandName: argv[0] ?? "<unknown>" },
        err,
      );
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
