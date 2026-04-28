import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { ToolName } from "../value-objects/tool-name.ts";

/**
 * Fact: a previously-enabled tool was disabled.
 *
 * Emitted by `ToolRegistration.disable(...)` after the aggregate
 * verifies that the transition is meaningful (the tool was actually
 * enabled). The MCP server still answers `tools/list` truthfully — a
 * disabled tool is hidden from the catalog (consumed by clients to
 * decide whether to call it) — and refuses subsequent `tools/call`
 * requests with `ToolDisabledError`.
 *
 * Invariants:
 * - `toolName` is the wire name of the tool that was disabled.
 * - `occurredAt` is the moment the toggle flipped.
 * - `eventName` is the stable `"mcp-server.tool-disabled"` identifier.
 */
export class ToolDisabled implements DomainEvent {
  public readonly eventName = "mcp-server.tool-disabled" as const;
  public readonly occurredAt: Timestamp;
  public readonly toolName: ToolName;

  public constructor(input: { toolName: ToolName; occurredAt: Timestamp }) {
    this.toolName = input.toolName;
    this.occurredAt = input.occurredAt;
  }
}
