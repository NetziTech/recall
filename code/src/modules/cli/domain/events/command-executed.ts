import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CommandExecution } from "../value-objects/command-execution.ts";

/**
 * Fact: a CLI sub-command finished running and was recorded in the
 * workspace's `CommandHistory`.
 *
 * Emitted by `CommandHistory.recordExecution(...)` exactly once per
 * recorded execution. Subscribers (audit log writer, telemetry) react
 * to it after the aggregate is persisted.
 *
 * Invariants:
 * - `workspaceId` identifies which workspace's history grew. Even if
 *   the CLI is invoked outside any workspace (e.g. `mcp-memoria` with
 *   no `--workspace`), the application layer is expected to attach a
 *   workspace id before recording — typically the auto-detected one
 *   from the current working directory.
 * - `execution` carries the full `CommandExecution` value object so
 *   subscribers do not have to round-trip through the repository.
 *   Including the whole VO makes the event self-describing for
 *   serialisation (audit log lines, telemetry).
 * - `occurredAt` MUST equal `execution.endedAt`: the canonical instant
 *   the fact happened is the moment the command finished. Producers
 *   are responsible for keeping the two in sync; the event does not
 *   re-validate to avoid duplicating the check.
 * - `eventName` is the stable `"cli.command-executed"` identifier
 *   (the prefix follows the convention documented in
 *   `shared/domain/types/domain-event.ts`).
 */
export class CommandExecuted implements DomainEvent {
  public readonly eventName = "cli.command-executed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly execution: CommandExecution;

  public constructor(input: {
    workspaceId: WorkspaceId;
    execution: CommandExecution;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.execution = input.execution;
    this.occurredAt = input.occurredAt;
  }
}
