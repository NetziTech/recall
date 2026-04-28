import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { ToolDisabled } from "../events/tool-disabled.ts";
import { ToolEnabled } from "../events/tool-enabled.ts";
import { ToolRegistered } from "../events/tool-registered.ts";
import { InvocationCount } from "../value-objects/invocation-count.ts";
import { LastInvokedAt } from "../value-objects/last-invoked-at.ts";
import type { ToolDescription } from "../value-objects/tool-description.ts";
import type { ToolName } from "../value-objects/tool-name.ts";

/**
 * Aggregate root representing a tool registered with the MCP server.
 *
 * Identity is `ToolName` (the wire string is unique within a registry
 * by construction — there is exactly one `mem.recall`, one
 * `mem.remember`, etc.). The aggregate owns the runtime metadata and
 * the bookkeeping that the registry exposes for `tools/list`,
 * telemetry and audit.
 *
 * Why an aggregate and not a value object:
 * - The data is mutable through business-meaningful operations
 *   (`enable`, `disable`, `recordInvocation`).
 * - It has identity (`ToolName`) and a stable lifetime separate from
 *   any single mutation; equality is "same name", not "same field
 *   values".
 * - It emits domain events on transitions, which is the canonical
 *   aggregate contract.
 *
 * Invariants:
 * - Identity (`name`) is immutable: `getName()` is stable for the
 *   entire lifetime of the aggregate.
 * - `enable(...)` and `disable(...)` are state-transition methods —
 *   they refuse no-op calls (an already-enabled tool cannot be
 *   re-enabled, and vice-versa) so the audit trail never contains
 *   spurious events.
 * - `recordInvocation(...)` is monotonic on `invocationCount`
 *   (delegated to the underlying `InvocationCount` VO) and refreshes
 *   `lastInvokedAt`. It is NOT gated on the enabled flag: the call
 *   itself only happens after the registry has greenlighted the
 *   request (the application layer guarantees this), and the
 *   bookkeeping should still record what was attempted.
 * - The internal events buffer is drained by `pullEvents()` after
 *   the application layer has persisted the change (or after the
 *   registry has acknowledged the new state, since this aggregate is
 *   in-memory only in the MVP).
 *
 * Persistence note:
 * - The MVP keeps the registry entirely in-memory (the composition
 *   root populates it at startup; nothing is written to disk). The
 *   aggregate therefore does NOT have an `embeddingStatus` /
 *   `createdAt` / `updatedAt` triplet — only `registeredAt` (set
 *   once, never changes) and `lastInvokedAt` are needed.
 */
export class ToolRegistration {
  private readonly name: ToolName;
  private readonly description: ToolDescription;
  private enabled: boolean;
  private readonly registeredAt: Timestamp;
  private lastInvokedAt: LastInvokedAt;
  private invocationCount: InvocationCount;
  private readonly events: DomainEvent[];

  private constructor(input: {
    name: ToolName;
    description: ToolDescription;
    enabled: boolean;
    registeredAt: Timestamp;
    lastInvokedAt: LastInvokedAt;
    invocationCount: InvocationCount;
    events: readonly DomainEvent[];
  }) {
    this.name = input.name;
    this.description = input.description;
    this.enabled = input.enabled;
    this.registeredAt = input.registeredAt;
    this.lastInvokedAt = input.lastInvokedAt;
    this.invocationCount = input.invocationCount;
    // Defensive copy: external callers hand us a `readonly` view but
    // the aggregate owns a mutable buffer internally so `pullEvents()`
    // can drain it.
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `ToolRegistration` into existence. Use this
   * exactly once per `ToolName`, when the composition root is
   * populating the registry at server boot.
   *
   * Defaults:
   * - `enabled`: `true` (a tool that boots disabled would not show
   *   up in `tools/list`, which is almost never what the operator
   *   wants; explicit `disable(...)` after register is the path for
   *   "registered but off").
   * - `lastInvokedAt`: `never` (no invocation yet).
   * - `invocationCount`: `0`.
   *
   * Emits `ToolRegistered`.
   */
  public static register(input: {
    name: ToolName;
    description: ToolDescription;
    occurredAt: Timestamp;
  }): ToolRegistration {
    const event = new ToolRegistered({
      toolName: input.name,
      occurredAt: input.occurredAt,
    });
    return new ToolRegistration({
      name: input.name,
      description: input.description,
      enabled: true,
      registeredAt: input.occurredAt,
      lastInvokedAt: LastInvokedAt.never(),
      invocationCount: InvocationCount.zero(),
      events: [event],
    });
  }

  /**
   * Rehydrates a `ToolRegistration` from previously-observed state
   * (used by tests and by future flows where the registry persists
   * its bookkeeping). Does NOT emit any event (no business fact is
   * happening).
   */
  public static rehydrate(input: {
    name: ToolName;
    description: ToolDescription;
    enabled: boolean;
    registeredAt: Timestamp;
    lastInvokedAt: LastInvokedAt;
    invocationCount: InvocationCount;
  }): ToolRegistration {
    return new ToolRegistration({
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      registeredAt: input.registeredAt,
      lastInvokedAt: input.lastInvokedAt,
      invocationCount: input.invocationCount,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Re-enables a previously-disabled tool. Refuses no-op calls
   * (already enabled) so the audit trail stays clean.
   *
   * Emits `ToolEnabled`.
   */
  public enable(input: { occurredAt: Timestamp }): void {
    if (this.enabled) {
      throw new InvariantViolationError(
        `tool "${this.name.toString()}" is already enabled`,
        { invariant: "mcp-server.tool.enable.already-enabled" },
      );
    }
    this.enabled = true;
    this.events.push(
      new ToolEnabled({
        toolName: this.name,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Disables a previously-enabled tool. Refuses no-op calls (already
   * disabled).
   *
   * Emits `ToolDisabled`.
   */
  public disable(input: { occurredAt: Timestamp }): void {
    if (!this.enabled) {
      throw new InvariantViolationError(
        `tool "${this.name.toString()}" is already disabled`,
        { invariant: "mcp-server.tool.disable.already-disabled" },
      );
    }
    this.enabled = false;
    this.events.push(
      new ToolDisabled({
        toolName: this.name,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Records that the tool was just invoked. Bumps `invocationCount`
   * and refreshes `lastInvokedAt`. Intentionally does NOT emit a
   * domain event: every tool call would emit one, which would drown
   * any meaningful event in the bus. Aggregating-style metrics
   * (counters, histograms) belong to the telemetry adapter, not the
   * domain event bus.
   *
   * The aggregate accepts the call regardless of the `enabled` flag:
   * the registry is the gatekeeper that decides whether to
   * dispatch, and once dispatched the bookkeeping should reflect the
   * attempt.
   */
  public recordInvocation(input: { occurredAt: Timestamp }): void {
    this.invocationCount = this.invocationCount.increment();
    this.lastInvokedAt = this.lastInvokedAt.touch(input.occurredAt);
  }

  // -- queries -------------------------------------------------------------

  public getName(): ToolName {
    return this.name;
  }

  public getDescription(): ToolDescription {
    return this.description;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isDisabled(): boolean {
    return !this.enabled;
  }

  public getRegisteredAt(): Timestamp {
    return this.registeredAt;
  }

  public getLastInvokedAt(): LastInvokedAt {
    return this.lastInvokedAt;
  }

  public getInvocationCount(): InvocationCount {
    return this.invocationCount;
  }

  /**
   * Drains and returns the buffered events. Mirrors the workspace
   * and decision aggregates' contract.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
