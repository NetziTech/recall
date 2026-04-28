/**
 * Public surface of `composition/event-bus/`.
 */

export { InMemoryEventBus } from "./in-memory-event-bus.ts";
export type {
  DomainEventBus,
  DomainEventSubscriber,
  DomainEventSubscription,
} from "./in-memory-event-bus.ts";
export { EventBusPublisher } from "./event-bus-publisher.ts";
