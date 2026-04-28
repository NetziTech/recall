import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { ToolName } from "../value-objects/tool-name.ts";

/**
 * Fact: a previously-disabled tool was re-enabled.
 *
 * Emitted by `ToolRegistration.enable(...)` after the aggregate
 * verifies that the transition is meaningful (the tool was actually
 * disabled). Subscribers may use this to refresh the `tools/list`
 * cache and to record the operator action in the audit log.
 *
 * Invariants:
 * - `toolName` is the wire name of the tool that was re-enabled.
 * - `occurredAt` is the moment the toggle flipped.
 * - `eventName` is the stable `"mcp-server.tool-enabled"` identifier.
 */
export class ToolEnabled implements DomainEvent {
  public readonly eventName = "mcp-server.tool-enabled" as const;
  public readonly occurredAt: Timestamp;
  public readonly toolName: ToolName;

  public constructor(input: { toolName: ToolName; occurredAt: Timestamp }) {
    this.toolName = input.toolName;
    this.occurredAt = input.occurredAt;
  }
}
