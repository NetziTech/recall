import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `MemoryEntryKindKind` values. Single source of truth for
 * the union below — adding a new memory kind is a one-line change here.
 *
 * Mirrors the persistent kinds documented in `docs/03-modelo-datos.md`
 * §4 (`turns`, `decisions`, `learnings`, `entities`, `tasks`). The
 * curator iterates over every kind during its decay/consolidation/
 * pruning passes (`docs/05-memoria-decay.md` §2), so the catalog
 * lives in the curator domain rather than being scattered across the
 * other modules.
 *
 * Note on scope: only the kinds that participate in the decay matrix
 * are listed. `relations` and `sessions` exist in the schema but are
 * not subject to per-row decay and therefore are intentionally omitted
 * (`docs/05-memoria-decay.md` §2 — "Decay diferencial por kind"). If a
 * future curator pass adds them, this catalog grows.
 */
const MEMORY_ENTRY_KINDS = [
  "decision",
  "learning",
  "entity",
  "task",
  "turn",
] as const;

export type MemoryEntryKindKind = (typeof MEMORY_ENTRY_KINDS)[number];

/**
 * Value object representing the kind of memory entry the curator is
 * currently processing.
 *
 * The discriminator is the only thing the curator domain cares about —
 * the rich aggregates (`Decision`, `Learning`, `Entity`, `Task`,
 * `Turn`) live in `modules/memory/domain/`; this VO keeps the curator
 * free of cross-module direct references for the cases where it only
 * needs to talk *about* a kind (e.g. naming a finding, looking up a
 * decay factor, deciding which repository to call from the application
 * layer).
 *
 * Invariants:
 * - The wrapped `kind` is always one of the five known values.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `MemoryEntryKind` are equal iff they share the same `kind`.
 */
export class MemoryEntryKind {
  private constructor(public readonly kind: MemoryEntryKindKind) {}

  public static decision(): MemoryEntryKind {
    return new MemoryEntryKind("decision");
  }

  public static learning(): MemoryEntryKind {
    return new MemoryEntryKind("learning");
  }

  public static entity(): MemoryEntryKind {
    return new MemoryEntryKind("entity");
  }

  public static task(): MemoryEntryKind {
    return new MemoryEntryKind("task");
  }

  public static turn(): MemoryEntryKind {
    return new MemoryEntryKind("turn");
  }

  /**
   * Builds a `MemoryEntryKind` from a raw string. Used when reading
   * persisted curator state (e.g. a finding row carrying the affected
   * kind as a string).
   */
  public static create(raw: string): MemoryEntryKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("memory entry kind must be a string", {
        field: "kind",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("memory entry kind must not be empty", {
        field: "kind",
      });
    }
    if (!MemoryEntryKind.isKind(trimmed)) {
      throw new InvalidInputError(
        `memory entry kind must be one of "decision" | "learning" | "entity" | "task" | "turn" (got: "${raw}")`,
        { field: "kind" },
      );
    }
    return new MemoryEntryKind(trimmed);
  }

  public static isKind(candidate: string): candidate is MemoryEntryKindKind {
    for (const known of MEMORY_ENTRY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns the catalog of every legal kind, frozen so callers cannot
   * mutate it. Useful for the curator's "iterate over every kind"
   * pass.
   */
  public static all(): readonly MemoryEntryKindKind[] {
    return MEMORY_ENTRY_KINDS;
  }

  public isDecision(): boolean {
    return this.kind === "decision";
  }

  public isLearning(): boolean {
    return this.kind === "learning";
  }

  public isEntity(): boolean {
    return this.kind === "entity";
  }

  public isTask(): boolean {
    return this.kind === "task";
  }

  public isTurn(): boolean {
    return this.kind === "turn";
  }

  public toString(): MemoryEntryKindKind {
    return this.kind;
  }

  public equals(other: MemoryEntryKind): boolean {
    return this.kind === other.kind;
  }
}
