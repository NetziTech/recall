/**
 * Sentinel exception thrown by the parser adapter when Commander has
 * already printed `--help` / `--version` output and the entrypoint
 * needs to exit cleanly.
 *
 * Rationale (B-CLI-1):
 *   Commander, configured with `.exitOverride()` so the CLI can own
 *   `process.exit`, does not return a `null` invocation after writing
 *   help — instead it THROWS a `CommanderError` whose `code` is
 *   `commander.helpDisplayed` / `commander.help` / `commander.version`.
 *   The original mapping treated those throws as unknown errors,
 *   which logged a spurious `CLI parser threw unexpectedly` ERROR
 *   record and returned exit 2 (`usageError`). Both were wrong: the
 *   user asked for help, got it, and the program should exit 0
 *   without polluting the log.
 *
 * Why we model this as a separate signal instead of an exit-code or a
 * special `CliInvocation` variant:
 *   - The parser already communicates "no command dispatched" by
 *     throwing. Moving help into the success path would force every
 *     caller of `CliEntrypoint.run` to know about a synthetic command
 *     name (`"help"`) that has no handler. The single-sink try/catch
 *     in the entrypoint stays simpler when help is just another
 *     thrown shape.
 *   - This class deliberately does NOT extend `CliDomainError` so the
 *     entrypoint's `instanceof CliDomainError` branch — which logs at
 *     warn level and returns `usageError` — is bypassed. The signal
 *     check sits BEFORE that branch and short-circuits to exit 0
 *     without any log line.
 *
 * Note on terminology: this is a *signaling* exception, not a domain
 * error. The class extends the standard `Error` for stack-trace
 * fidelity in logs that capture genuine bugs (e.g. an entrypoint
 * implementation that forgets to handle the signal would still see a
 * useful stack), but no consumer should ever catch it as if it were
 * an error condition. The contract is: `parse()` throws it, the
 * entrypoint converts it into a clean exit, end of story.
 */
export class HelpRequestedSignal extends Error {
  /**
   * Stable identifier so adapters that survey error shapes (e.g.
   * future telemetry) can recognise the signal without relying on
   * `instanceof` (which breaks across module boundaries when the
   * class is tree-shaken into multiple bundles).
   */
  public readonly code = "cli.help-requested";

  public constructor(message: string) {
    super(message);
    this.name = "HelpRequestedSignal";
  }
}
