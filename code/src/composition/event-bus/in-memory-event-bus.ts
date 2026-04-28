/**
 * In-process, in-memory event bus.
 *
 * Closes warning W-3.3-DDD-2 (EventBus pendiente) listed in
 * `HANDOFF.md §6.7 phases.phase-3-modules.consolidated_warnings_for_phase_5_architect`.
 *
 * Why this lives in `composition/`:
 * - The aggregates of every module emit `DomainEvent` instances via
 *   their internal `pullEvents()` queue. Ports (repositories, use
 *   cases) do not consume the events themselves; the `composition`
 *   layer is the only place that knows about every module and is
 *   therefore the natural site for a cross-module event bus.
 * - Adding an `EventBus` port to `shared/application/ports/` would
 *   force every aggregate to take the bus as a dependency at the
 *   domain level — the opposite of what `pullEvents()` was designed
 *   to allow. Instead, the bus stays in `composition` and a future
 *   middleware (e.g. a wrapper around `Repository.save`) can drain
 *   `aggregate.pullEvents()` and push them to the bus.
 *
 * Status (Fase 4):
 * - The bus is wired and exposed via the `Container`. Subscriber
 *   integration with the existing repositories is deferred to Fase 5
 *   (Testing) — the canonical pattern is `await
 *   bus.publishMany(aggregate.pullEvents())` after every successful
 *   `save`. The bus is therefore *available* but currently *idle*;
 *   no events are dispatched yet.
 *
 * Threading:
 * - Single-threaded by design (Node 20 single-thread for application
 *   code). Subscriber callbacks run sequentially in registration
 *   order. The bus catches subscriber errors and surfaces them via
 *   the injected logger so a buggy subscriber cannot break a
 *   different subscriber further down the chain.
 *
 * Memory:
 * - Subscribers are kept in a plain `Map` keyed on event name.
 *   Unsubscription is exposed via the returned token for tests; the
 *   production wiring registers subscribers once at boot.
 */

import type { Logger } from "../../shared/application/ports/logger.port.ts";
import type { DomainEvent } from "../../shared/domain/types/domain-event.ts";

/**
 * Handler signature for an event subscription. The bus invokes
 * subscribers sequentially with the published event.
 */
export type DomainEventSubscriber = (event: DomainEvent) => void | Promise<void>;

/**
 * Token returned by {@link InMemoryEventBus.subscribe} so callers can
 * unsubscribe deterministically (mostly useful for tests).
 */
export interface DomainEventSubscription {
  readonly unsubscribe: () => void;
}

/**
 * Public surface of the bus. Kept narrow on purpose so future
 * integrations (e.g. Node `EventEmitter`-backed implementation, or a
 * cross-process bus) can swap the concrete class without churning the
 * call sites.
 */
export interface DomainEventBus {
  /**
   * Subscribes a handler to a specific `eventName` (matches the
   * convention `<module>.<event-name-in-past-tense-kebab-case>` from
   * the `domain-event.ts` JSDoc). Returns a subscription token so the
   * caller can release the subscription later.
   */
  subscribe(eventName: string, handler: DomainEventSubscriber): DomainEventSubscription;

  /**
   * Subscribes a handler that will be invoked for every event,
   * regardless of name. Used by the audit logger.
   */
  subscribeAll(handler: DomainEventSubscriber): DomainEventSubscription;

  /**
   * Publishes a single event. Awaits every subscriber so the caller
   * can reliably observe completion.
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * Publishes a batch of events in order. Equivalent to a sequential
   * `publish` over the array.
   */
  publishMany(events: readonly DomainEvent[]): Promise<void>;
}

/**
 * Concrete implementation backed by two plain `Map`s. Keys on the
 * named subscription map are event names; values are arrays of
 * handlers (the bus allows multiple subscribers per event name).
 */
export class InMemoryEventBus implements DomainEventBus {
  private readonly named: Map<string, DomainEventSubscriber[]>;
  private readonly catchAll: DomainEventSubscriber[];

  public constructor(private readonly logger: Logger) {
    this.named = new Map<string, DomainEventSubscriber[]>();
    this.catchAll = [];
  }

  public subscribe(
    eventName: string,
    handler: DomainEventSubscriber,
  ): DomainEventSubscription {
    const list = this.named.get(eventName) ?? [];
    list.push(handler);
    this.named.set(eventName, list);
    return {
      unsubscribe: (): void => {
        const current = this.named.get(eventName);
        if (current === undefined) return;
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) this.named.delete(eventName);
      },
    };
  }

  public subscribeAll(handler: DomainEventSubscriber): DomainEventSubscription {
    this.catchAll.push(handler);
    return {
      unsubscribe: (): void => {
        const index = this.catchAll.indexOf(handler);
        if (index >= 0) this.catchAll.splice(index, 1);
      },
    };
  }

  public async publish(event: DomainEvent): Promise<void> {
    const named = this.named.get(event.eventName);
    if (named !== undefined) {
      for (const handler of named) {
        await this.runHandler(handler, event);
      }
    }
    for (const handler of this.catchAll) {
      await this.runHandler(handler, event);
    }
  }

  public async publishMany(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  private async runHandler(
    handler: DomainEventSubscriber,
    event: DomainEvent,
  ): Promise<void> {
    try {
      await handler(event);
    } catch (err: unknown) {
      // Swallow subscriber errors; they MUST NOT cascade into other
      // subscribers or back to the publishing aggregate. The
      // application layer treats event delivery as best-effort.
      this.logger.warn(
        {
          eventName: event.eventName,
          err: err instanceof Error ? err.message : String(err),
        },
        "domain event subscriber threw",
      );
    }
  }
}
