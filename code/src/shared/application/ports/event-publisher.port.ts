import type { DomainEvent } from "../../domain/types/domain-event.ts";

/**
 * Driven (output) port for publishing buffered domain events to the
 * cross-module event bus.
 *
 * Why this lives in `shared/application/ports/`:
 * - Every module emits domain events from its aggregates
 *   (`Decision.pullEvents()`, `Workspace.pullEvents()`,
 *   `CuratorRun.pullEvents()`, ...) and several modules need to react
 *   to events emitted by others (the recall layer invalidates caches
 *   on `decision.superseded`, the secrets module logs `secrets.detected`,
 *   the curator subscribes to `memory.session-ended` to schedule a
 *   rollup, ...). Per `docs/12-lineamientos-arquitectura.md` §1.5
 *   Regla 3 the publisher port MUST live in `shared/`.
 * - Closes warning W-3.3-DDD-2 from Fase 3: the port previously did
 *   not exist; use cases were forced to drop events on the floor or
 *   ad-hoc inject a logger as a poor proxy.
 *
 * Why this port is intentionally narrow (no subscribe API, no topic
 * filtering, no persistence):
 * - SOLID-ISP: the *publishing* path is what use cases need. The
 *   *subscribing* path lives on the implementation side (the
 *   composition root wires concrete handlers); a use case never asks
 *   the bus to register a subscriber. Mixing the two would force every
 *   adapter into a contract bigger than its actual usage.
 * - SOLID-DIP: the publisher is dimension-free; it accepts any
 *   `DomainEvent` implementation regardless of the module that owns
 *   it. The discriminator (`eventName`) lives on the event itself
 *   (per the `DomainEvent` JSDoc) — subscribers route on it without
 *   the publisher knowing.
 *
 * Implementation expectations (composition root, Fase 4):
 * - `composition/event-bus/in-memory-event-bus.ts` wraps a Map of
 *   `eventName → handlers[]`. `publish(event)` iterates the matching
 *   handlers synchronously inside a microtask so the use case's
 *   `await save(...)` settles before reactions fire.
 * - The publisher MUST NOT throw on a publish call: if a subscriber
 *   throws, the implementation catches and logs (handler-level
 *   isolation). Otherwise a misbehaving subscriber would tear down
 *   the use case path that triggered it.
 *
 * Calling convention (use cases):
 * 1. Call the aggregate's mutation (`decision.supersede(...)`).
 * 2. Persist via the repository (`decisions.save(decision)`).
 * 3. Drain events via `decision.pullEvents()`.
 * 4. Hand them to the publisher: `eventPublisher.publish(events)`.
 *
 * Step 3 happens AFTER step 2 (per the repository's contract — events
 * are never consumed by repositories). Step 4 happens AFTER step 3 so
 * a write failure does not surface phantom events to subscribers.
 *
 * Test doubles:
 * - `RecordingEventPublisher` keeps every published event in an
 *   internal array and exposes `published()` so tests can assert "the
 *   use case emitted exactly the expected facts".
 * - `SilentEventPublisher` (no-op) is used by perf benchmarks where
 *   the publisher would skew timings.
 */
export interface EventPublisher {
  /**
   * Publishes a single domain event to every interested subscriber.
   *
   * The publisher MAY dispatch synchronously or via a microtask; the
   * caller MUST NOT depend on the timing. The promise resolves once
   * the publisher has handed the event to the underlying bus (NOT
   * once every subscriber has finished processing it).
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * Publishes a batch of events in order. Equivalent to calling
   * `publish` once per event but lets the implementation amortise
   * overhead (e.g. a single transaction guard around the whole batch).
   *
   * The contract is "ordered, at-most-once-per-event": the publisher
   * MUST iterate the array in index order and MUST NOT duplicate an
   * event. If a subscriber throws on event `i`, the publisher logs
   * the failure and continues with event `i+1` (handler-level
   * isolation, not batch-level fail-fast).
   */
  publishAll(events: readonly DomainEvent[]): Promise<void>;
}
