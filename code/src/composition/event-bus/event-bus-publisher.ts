/**
 * Adapter that bridges the shared `EventPublisher` driven port (in
 * `shared/application/ports/event-publisher.port.ts`) to the
 * composition-owned `DomainEventBus`.
 *
 * Why this adapter lives in `composition/`:
 * - The `EventPublisher` port is what use cases (every memory write,
 *   every session lifecycle, every workspace mode change, ...)
 *   consume. The concrete bus is wired in `composition/event-bus/`
 *   so the port stays free of any subscribe-side concerns.
 * - Closes warning W-3.3-DDD-2 from Fase 3: events drained via
 *   `aggregate.pullEvents()` now have a typed sumidero that flows
 *   straight into the in-memory bus.
 *
 * Method shape:
 * - `publish(event)`     → `bus.publish(event)`.
 * - `publishAll(events)` → `bus.publishMany(events)` (the bus exposes
 *    a batch primitive; the publisher port mirrors it under a
 *    slightly different name, kept stable on the port for clarity).
 *
 * The publisher MUST NOT throw on a publish call: handler-level
 * isolation is the bus's responsibility (the bus catches subscriber
 * errors and logs them). The adapter only forwards.
 */

import type { EventPublisher } from "../../shared/application/ports/event-publisher.port.ts";
import type { DomainEvent } from "../../shared/domain/types/domain-event.ts";
import type { DomainEventBus } from "./in-memory-event-bus.ts";

export class EventBusPublisher implements EventPublisher {
  public constructor(private readonly bus: DomainEventBus) {}

  public publish(event: DomainEvent): Promise<void> {
    return this.bus.publish(event);
  }

  public publishAll(events: readonly DomainEvent[]): Promise<void> {
    return this.bus.publishMany(events);
  }
}
