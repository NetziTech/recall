import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { CommandArgs } from "./command-args.ts";
import type { CommandName } from "./command-name.ts";
import type { CommandOutput } from "./command-output.ts";

/**
 * Value object recording one *complete* CLI invocation: which command
 * ran, with which raw args, when it started, when it ended, and what it
 * produced (`CommandOutput`).
 *
 * The VO is the unit of audit / history: the (optional) `CommandHistory`
 * aggregate stores a buffer of these so the user can answer questions
 * like "what was the last command I ran in this workspace?" or "did
 * the previous `audit` exit successfully?".
 *
 * Why a VO and not an entity:
 * - Two `CommandExecution` instances with identical fields represent
 *   the *same* execution from a domain perspective. There is no
 *   separate "execution id" the rest of the model needs to reference;
 *   identity is implicit in the (start, end, name, args) tuple.
 * - Mutating the record after the command has finished would be
 *   meaningless: the facts are facts.
 *
 * Invariants:
 * - `endedAt` is greater than or equal to `startedAt`. A negative
 *   duration is rejected as an `InvariantViolationError`. Equality is
 *   tolerated because instantaneous commands (synchronous, no I/O) can
 *   share a millisecond timestamp on coarse clocks.
 * - All fields are immutable readonly properties.
 *
 * Equality:
 * - Two `CommandExecution` instances are equal iff every field matches
 *   (component-wise: `name.equals`, `args.equals`,
 *   `startedAt.equals`, `endedAt.equals`, `output.equals`).
 */
export class CommandExecution {
  private constructor(
    public readonly name: CommandName,
    public readonly args: CommandArgs,
    public readonly startedAt: Timestamp,
    public readonly endedAt: Timestamp,
    public readonly output: CommandOutput,
  ) {}

  /**
   * Builds a `CommandExecution` from explicit values. The factory
   * validates the temporal invariant (`endedAt >= startedAt`) and
   * defers everything else to the components themselves (which were
   * already validated when constructed).
   */
  public static create(input: {
    name: CommandName;
    args: CommandArgs;
    startedAt: Timestamp;
    endedAt: Timestamp;
    output: CommandOutput;
  }): CommandExecution {
    if (input.endedAt.isBefore(input.startedAt)) {
      throw new InvariantViolationError(
        `command execution cannot end before it started (started=${String(
          input.startedAt.toEpochMs(),
        )}, ended=${String(input.endedAt.toEpochMs())})`,
        { invariant: "cli.command-execution.monotonic-time" },
      );
    }
    return new CommandExecution(
      input.name,
      input.args,
      input.startedAt,
      input.endedAt,
      input.output,
    );
  }

  /**
   * Duration of the execution in milliseconds. Always non-negative
   * thanks to the invariant validated in the factory.
   */
  public durationMs(): number {
    return this.endedAt.diff(this.startedAt);
  }

  /**
   * True iff the underlying output reports a successful exit. Delegates
   * to `CommandOutput.isSuccess()` so the truth table for "what counts
   * as success" stays in one place.
   */
  public wasSuccessful(): boolean {
    return this.output.isSuccess();
  }

  public equals(other: CommandExecution): boolean {
    return (
      this.name.equals(other.name) &&
      this.args.equals(other.args) &&
      this.startedAt.equals(other.startedAt) &&
      this.endedAt.equals(other.endedAt) &&
      this.output.equals(other.output)
    );
  }
}
