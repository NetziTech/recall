import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { CommandExecuted } from "../events/command-executed.ts";
import type { CommandExecution } from "../value-objects/command-execution.ts";

/**
 * Default size of the rolling buffer when a caller doesn't pin one
 * explicitly. Sized to be useful (a couple of dozen entries — enough to
 * cover a typical CLI session) without growing unbounded for long-lived
 * workspaces. The application layer can override per workspace via
 * configuration if needed.
 */
const DEFAULT_CAPACITY = 50;

/**
 * Hard upper bound on the buffer size. Beyond this number, the
 * `CommandHistory` stops being a "recent activity" view and becomes a
 * full audit log — a concern that belongs to a dedicated audit module
 * (see `docs/03-modelo-datos.md` §4.8 "audit_log") rather than to the
 * CLI domain.
 */
const MAX_CAPACITY = 1000;

/**
 * Aggregate root for the `cli` bounded context.
 *
 * Why model this in `domain/` at all when the CLI is otherwise a thin
 * domain:
 *
 *   1. The product surface includes inspection commands like
 *      `mcp-memoria stats` and `mcp-memoria curator-log`
 *      (`docs/07-instalacion.md` §7) that benefit from a "what did the
 *      user run recently in this workspace?" answer. Without a domain
 *      object, every consumer would have to hand-roll the same ring
 *      buffer logic on top of the audit log table.
 *   2. The buffer encodes a real domain invariant — the order of
 *      executions is monotonically non-decreasing in `endedAt` — that
 *      cannot be enforced by the persistence layer alone (SQL ORDER BY
 *      sorts at read time, but does not refuse out-of-order inserts).
 *   3. Centralising the buffer makes `CommandExecuted` a meaningful
 *      domain event: it is emitted exactly when an execution joins the
 *      ring, and subscribers (telemetry, audit log writer) get a
 *      single hook.
 *
 * If the MVP later decides to drop history persistence, this aggregate
 * stays useful as a process-local view: the application layer can
 * still build one in memory and pull events for logging.
 *
 * Identity:
 * - One `CommandHistory` per `WorkspaceId`. The workspace is the only
 *   meaningful scope for "recent commands": cross-workspace history
 *   would mix unrelated activity and reveal nothing actionable.
 *
 * Invariants:
 * - `capacity >= 1` and `capacity <= MAX_CAPACITY`.
 * - `executions.length <= capacity` at all times.
 * - The list is ordered oldest-first (`executions[0]` is the oldest
 *   that still fits in the buffer).
 * - The list is monotonic in `endedAt`: for every adjacent pair `(a,
 *   b)`, `a.endedAt <= b.endedAt`. The aggregate refuses out-of-order
 *   `recordExecution` calls.
 *
 * Equality:
 * - Aggregates are compared by identity (`workspaceId`), not by
 *   content. The `equals(...)` method follows the project convention
 *   for aggregates.
 */
export class CommandHistory {
  private readonly workspaceId: WorkspaceId;
  private readonly capacity: number;
  private readonly executions: CommandExecution[];
  private readonly events: DomainEvent[];

  private constructor(
    workspaceId: WorkspaceId,
    capacity: number,
    executions: readonly CommandExecution[],
    events: readonly DomainEvent[],
  ) {
    this.workspaceId = workspaceId;
    this.capacity = capacity;
    // Defensive copies: the constructor accepts `readonly` views but
    // owns mutable buffers internally so `recordExecution` and
    // `pullEvents` can drain them.
    this.executions = [...executions];
    this.events = [...events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new empty `CommandHistory` into existence. Used the
   * first time the application layer needs to record an execution for
   * a workspace that has none yet on disk.
   *
   * Does NOT emit an event: bringing the buffer into existence is not
   * a fact the rest of the system needs to react to (the first
   * `recordExecution` call will emit `CommandExecuted` instead).
   */
  public static empty(input: {
    workspaceId: WorkspaceId;
    capacity?: number;
  }): CommandHistory {
    const capacity = input.capacity ?? DEFAULT_CAPACITY;
    CommandHistory.assertCapacity(capacity);
    return new CommandHistory(input.workspaceId, capacity, [], []);
  }

  /**
   * Rehydrates a `CommandHistory` from previously-persisted state.
   * Used by the repository when loading from disk. Validates that the
   * provided executions respect the capacity and the monotonic-time
   * invariants — a corrupted store would otherwise silently break the
   * domain contract.
   */
  public static rehydrate(input: {
    workspaceId: WorkspaceId;
    capacity?: number;
    executions: readonly CommandExecution[];
  }): CommandHistory {
    const capacity = input.capacity ?? DEFAULT_CAPACITY;
    CommandHistory.assertCapacity(capacity);
    if (input.executions.length > capacity) {
      throw new InvariantViolationError(
        `cannot rehydrate command history with ${String(
          input.executions.length,
        )} executions for capacity ${String(capacity)}`,
        { invariant: "cli.command-history.capacity" },
      );
    }
    for (let i = 1; i < input.executions.length; i += 1) {
      const previous = input.executions[i - 1];
      const current = input.executions[i];
      if (previous === undefined || current === undefined) continue;
      if (current.endedAt.isBefore(previous.endedAt)) {
        throw new InvariantViolationError(
          `command history must be ordered by endedAt; index ${String(i)} is out of order`,
          { invariant: "cli.command-history.monotonic-time" },
        );
      }
    }
    return new CommandHistory(
      input.workspaceId,
      capacity,
      input.executions,
      [],
    );
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Appends a new execution to the buffer, evicting the oldest entry
   * if the capacity is full. Emits `CommandExecuted`.
   *
   * Refuses out-of-order calls: the new execution's `endedAt` MUST be
   * greater than or equal to the current tail's `endedAt`. The
   * application layer is responsible for time-stamping executions
   * monotonically via the injected `Clock` port.
   */
  public recordExecution(execution: CommandExecution): void {
    const tail = this.tailOrNull();
    if (tail !== null && execution.endedAt.isBefore(tail.endedAt)) {
      throw new InvariantViolationError(
        `command execution ended at ${String(
          execution.endedAt.toEpochMs(),
        )} cannot precede the previous tail at ${String(tail.endedAt.toEpochMs())}`,
        { invariant: "cli.command-history.monotonic-time" },
      );
    }
    this.executions.push(execution);
    while (this.executions.length > this.capacity) {
      // O(n) shift on a small ring is acceptable; the alternative
      // (circular index) would leak ring-buffer mechanics into every
      // query method. Capacity is bounded by `MAX_CAPACITY`.
      this.executions.shift();
    }
    this.events.push(
      new CommandExecuted({
        workspaceId: this.workspaceId,
        execution,
        occurredAt: execution.endedAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): WorkspaceId {
    return this.workspaceId;
  }

  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Returns the most recent `limit` executions, newest-first. The
   * `limit` defaults to the buffer's capacity (i.e. "everything").
   *
   * The returned array is a fresh, frozen, shallow copy: callers
   * cannot mutate the aggregate's internal state by writing into the
   * result.
   */
  public recentExecutions(limit?: number): readonly CommandExecution[] {
    const requested = limit ?? this.capacity;
    if (!Number.isInteger(requested) || requested < 0) {
      throw new InvalidInputError(
        "command history limit must be a non-negative integer",
        { field: "limit" },
      );
    }
    const effective = Math.min(requested, this.executions.length);
    if (effective === 0) return Object.freeze([]);
    const out: CommandExecution[] = new Array<CommandExecution>(effective);
    // Walk from the tail backwards so the result is newest-first.
    for (let i = 0; i < effective; i += 1) {
      const source = this.executions[this.executions.length - 1 - i];
      if (source === undefined) continue;
      out[i] = source;
    }
    return Object.freeze(out);
  }

  public size(): number {
    return this.executions.length;
  }

  public isEmpty(): boolean {
    return this.executions.length === 0;
  }

  /**
   * Returns the most recently recorded execution, or `null` if the
   * buffer is empty. Convenience for the common "what did I run last?"
   * query.
   */
  public latest(): CommandExecution | null {
    return this.tailOrNull();
  }

  /**
   * Drains and returns the buffered events. The internal buffer is
   * emptied so subsequent calls only return events emitted after the
   * pull. Mirrors the contract used by every other aggregate in the
   * codebase (`Workspace.pullEvents`, `Decision.pullEvents`, ...).
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  /**
   * Identity comparison. Two `CommandHistory` aggregates are equal iff
   * they share the same `workspaceId`; the buffer contents are part of
   * the state, not the identity.
   */
  public equals(other: CommandHistory): boolean {
    return this.workspaceId.equals(other.workspaceId);
  }

  // -- internals -----------------------------------------------------------

  private tailOrNull(): CommandExecution | null {
    if (this.executions.length === 0) return null;
    const tail = this.executions[this.executions.length - 1];
    return tail ?? null;
  }

  private static assertCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidInputError(
        `command history capacity must be a positive integer (got: ${String(capacity)})`,
        { field: "capacity" },
      );
    }
    if (capacity > MAX_CAPACITY) {
      throw new InvalidInputError(
        `command history capacity ${String(capacity)} exceeds maximum ${String(MAX_CAPACITY)}`,
        { field: "capacity" },
      );
    }
  }
}
