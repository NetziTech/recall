import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { ToolName } from "../value-objects/tool-name.ts";

/**
 * Fact: a tool was just registered with the MCP server.
 *
 * Emitted exactly once per tool, by `ToolRegistration.register(...)`.
 * Subscribers (audit log, future telemetry, the server-side
 * `tools/list` cache invalidator) react after the registration is
 * persisted to the in-process registry.
 *
 * Invariants:
 * - `toolName` is the freshly-registered tool's wire name.
 * - `occurredAt` is the canonical registration instant.
 * - `eventName` is the stable `"mcp-server.tool-registered"`
 *   identifier.
 */
export class ToolRegistered implements DomainEvent {
  public readonly eventName = "mcp-server.tool-registered" as const;
  public readonly occurredAt: Timestamp;
  public readonly toolName: ToolName;

  public constructor(input: { toolName: ToolName; occurredAt: Timestamp }) {
    this.toolName = input.toolName;
    this.occurredAt = input.occurredAt;
  }
}
