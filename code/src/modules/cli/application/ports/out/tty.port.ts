/**
 * Driven (output) ports the CLI uses to write to the terminal.
 *
 * Why we model stdout / stderr / prompt as separate ports rather
 * than a single `Tty` interface:
 *   - SOLID-ISP: a non-interactive command (e.g. `server`) doesn't
 *     need the prompt port; an audit summary doesn't need the
 *     prompt port. Splitting the surface lets handlers depend only
 *     on what they use.
 *   - Test doubles: a `RecordingStdout` is trivial; a recording
 *     `Prompt` needs scripted answers and is easier to model
 *     separately.
 *
 * Why no `process.exit` here:
 *   - `process.exit` is a transport concern; it is the
 *     entrypoint adapter (`CliEntrypoint`) that calls it after the
 *     use case returns. The use cases produce a `CommandOutput`
 *     value object; the entrypoint translates the embedded
 *     `ExitCode` into `process.exit(...)`.
 */

export interface Stdout {
  /** Write `text` to stdout verbatim. No trailing newline added. */
  write(text: string): void;
}

export interface Stderr {
  /** Write `text` to stderr verbatim. No trailing newline added. */
  write(text: string): void;
}

/**
 * Interactive prompt port for confirmations and passphrase entry.
 *
 * Implementations:
 *   - `NodeReadlinePrompt` — wraps `node:readline/promises` with
 *     terminal-aware echo for passphrases.
 *   - `ScriptedPrompt` (test fixture) — yields scripted answers
 *     from an array.
 */
export interface Prompt {
  /**
   * Asks the user a yes/no question. Returns `true` only when the
   * user types one of the affirmative tokens (`y`, `yes`, `s`, `si`,
   * `sí`). Spanish + English to match `docs/13-workflow-agentes.md`'s
   * UI-language guideline.
   */
  confirm(question: string): Promise<boolean>;

  /**
   * Reads a freeform line from the user (terminal echo enabled).
   */
  readLine(prompt: string): Promise<string>;

  /**
   * Reads a passphrase (terminal echo disabled). Implementations
   * MUST wipe the read buffer after returning so a future memory
   * scrape cannot recover it.
   */
  readPassphrase(prompt: string): Promise<string>;
}
