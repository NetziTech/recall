import { ExitCode } from "./exit-code.ts";

/**
 * Value object capturing the *result* of running one CLI sub-command:
 * everything that was written to `stdout`, everything that was written
 * to `stderr`, and the exit status the process is about to return.
 *
 * The VO is the canonical handoff between the application layer
 * (which knows what should be printed) and the infrastructure layer
 * (which actually writes to the terminal and calls `process.exit`).
 *
 * Why three fields and not, say, a single `string`:
 *   - The CLI follows POSIX conventions: structured output goes to
 *     `stdout` (so it can be piped: `recall stats | grep ...`),
 *     human-readable diagnostics go to `stderr`. Conflating the two
 *     would break composability.
 *   - The exit code is independent from the text: a command may emit
 *     diagnostics on `stderr` and still exit `success` (warnings), or
 *     emit nothing and exit `genericError` (silent failure). They are
 *     orthogonal and must be modelled as such.
 *
 * Invariants:
 * - `stdout` and `stderr` are strings (possibly empty). They are stored
 *   verbatim — no trimming, no newline normalisation. The terminal
 *   layer is responsible for writing them as-is so that things like
 *   coloured ANSI escapes are preserved.
 * - `exitCode` is a fully validated `ExitCode` instance.
 * - Instances are immutable: the `withStdout` and `withStderr` builders
 *   *always* return a new instance.
 *
 * Equality:
 * - Two `CommandOutput` instances are equal iff their `stdout`,
 *   `stderr` and `exitCode` all match.
 */
export class CommandOutput {
  private constructor(
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: ExitCode,
  ) {}

  /**
   * Builds a `CommandOutput` from explicit values. Used by tests and by
   * use cases that compose the output in a single step.
   */
  public static create(input: {
    stdout: string;
    stderr: string;
    exitCode: ExitCode;
  }): CommandOutput {
    return new CommandOutput(input.stdout, input.stderr, input.exitCode);
  }

  /**
   * Convenience factory for an empty successful output: no text on
   * either stream, exit code `success`.
   */
  public static empty(): CommandOutput {
    return new CommandOutput("", "", ExitCode.success());
  }

  /**
   * Convenience factory for the common "print this and succeed" path.
   */
  public static stdoutOnly(text: string): CommandOutput {
    return new CommandOutput(text, "", ExitCode.success());
  }

  /**
   * Convenience factory for the common "complain on stderr and exit
   * with an error" path.
   */
  public static failure(input: {
    stderr: string;
    exitCode: ExitCode;
  }): CommandOutput {
    return new CommandOutput("", input.stderr, input.exitCode);
  }

  /**
   * Returns a new `CommandOutput` whose `stdout` field is `text`,
   * leaving `stderr` and `exitCode` untouched.
   *
   * The semantics are *replace*, not *append*: a use case typically
   * builds the full text in one go (template strings, JSON.stringify)
   * and the builder is just a way to swap one slot at a time. Append
   * semantics would create an O(n^2) string-concat pitfall and would
   * leak buffer-management concerns into the domain.
   */
  public withStdout(text: string): CommandOutput {
    return new CommandOutput(text, this.stderr, this.exitCode);
  }

  /**
   * Returns a new `CommandOutput` whose `stderr` field is `text`,
   * leaving `stdout` and `exitCode` untouched. Same replace-not-append
   * semantics as `withStdout`.
   */
  public withStderr(text: string): CommandOutput {
    return new CommandOutput(this.stdout, text, this.exitCode);
  }

  /**
   * Returns a new `CommandOutput` whose `exitCode` is `code`, leaving
   * the text streams untouched. Useful for the "format the message
   * first, decide the severity later" flow.
   */
  public withExitCode(code: ExitCode): CommandOutput {
    return new CommandOutput(this.stdout, this.stderr, code);
  }

  /**
   * True iff the command exited with `success` (the underlying
   * `ExitCode` is delegated to keep the truth table in one place).
   */
  public isSuccess(): boolean {
    return this.exitCode.isSuccess();
  }

  public equals(other: CommandOutput): boolean {
    return (
      this.stdout === other.stdout &&
      this.stderr === other.stderr &&
      this.exitCode.equals(other.exitCode)
    );
  }
}
