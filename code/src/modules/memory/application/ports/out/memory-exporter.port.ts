import type { Decision } from "../../../domain/aggregates/decision.ts";
import type { Entity } from "../../../domain/aggregates/entity.ts";
import type { Learning } from "../../../domain/aggregates/learning.ts";
import type { Relation } from "../../../domain/aggregates/relation.ts";
import type { Session } from "../../../domain/aggregates/session.ts";
import type { Task } from "../../../domain/aggregates/task.ts";
import type { Turn } from "../../../domain/aggregates/turn.ts";

/**
 * Aggregate snapshot the application layer hands to the exporter.
 *
 * The use case loads every aggregate via the repositories, then passes
 * the bag to the exporter so the serialisation layer is independent
 * of the persistence layer (the exporter does not know what SQLite
 * looks like; it only knows how to render aggregates to JSON).
 */
export interface MemorySnapshot {
  readonly decisions: readonly Decision[];
  readonly learnings: readonly Learning[];
  readonly entities: readonly Entity[];
  readonly tasks: readonly Task[];
  readonly turns: readonly Turn[];
  readonly sessions: readonly Session[];
  readonly relations: readonly Relation[];
}

/**
 * Driven (output) port: serialise a `MemorySnapshot` to a portable
 * UTF-8 JSON string.
 *
 * The contract is "round-trip": `MemoryImporter.parse(exporter.serialise(s))`
 * MUST produce a snapshot equivalent to `s` (modulo array ordering,
 * which is implementation-defined for stability across exports).
 *
 * Failures surface as
 * `MemoryInfrastructureError.exportSerializeFailed(...)`.
 */
export interface MemoryExporter {
  serialise(snapshot: MemorySnapshot): string;
}
