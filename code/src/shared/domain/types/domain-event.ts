import type { Timestamp } from "../value-objects/timestamp.ts";

/**
 * Marker interface implemented by every event a domain aggregate emits.
 *
 * Events are facts about something that *already happened*. They are
 * immutable and named in the past tense (`DecisionRecorded`,
 * `WorkspaceUnlocked`, `LearningPruned`). Aggregates collect them in an
 * internal buffer that the application layer drains after persistence,
 * so that side-effect handlers (logging, notifications, downstream
 * reactions) only run if the write succeeded.
 *
 * Invariants:
 * - `occurredAt` is the moment the fact happened, expressed via the
 *   shared `Timestamp` value object. The application layer supplies it
 *   from the injected `Clock` port; the domain itself never reads the
 *   wall clock.
 * - `eventName` is a stable, machine-readable identifier in the form
 *   `"<module>.<event-name-in-past-tense-kebab-case>"` (e.g.
 *   `"workspace.initialized"`, `"memory.decision-recorded"`,
 *   `"curator.learnings-consolidated"`). The module prefix prevents
 *   collisions across the eight bounded contexts; the kebab-case past
 *   tense reads naturally in audit logs. The literal value is the
 *   discriminator subscribers use when routing, so it must remain stable
 *   across releases (treat as a public contract).
 * - All payload fields on concrete subtypes MUST be `readonly`. Events
 *   are never mutated after construction.
 */
export interface DomainEvent {
  readonly occurredAt: Timestamp;
  readonly eventName: string;
}
