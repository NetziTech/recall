/**
 * Re-export of the in-memory `DomainEventBus` so the bootstrap
 * surface includes it (Fase 4 brief item B.event-bus). The concrete
 * implementation lives under `composition/event-bus/` because it is
 * a wiring concern that touches multiple modules' aggregate event
 * shapes.
 *
 * This file intentionally does not introduce a separate
 * implementation: a second copy would diverge from the composition
 * one over time and break the contract "composition is the only
 * multi-module site".
 */

export {
  InMemoryEventBus,
  type DomainEventBus,
  type DomainEventSubscriber,
  type DomainEventSubscription,
} from "../composition/event-bus/index.ts";
