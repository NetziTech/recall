import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { MemoryEntryKind, type MemoryEntryKindKind } from "./memory-entry-kind.ts";

/**
 * Default soft cap on the number of active entries per kind. Mirrors
 * the `curator.max_entries_per_kind: 5000` knob documented in
 * `docs/03-modelo-datos.md` §2 ("`.recall/config.json`").
 *
 * The cap is informational — the curator does not delete to enforce
 * it. Instead, exceeding it triggers more aggressive consolidation
 * and pruning passes (see `docs/05-memoria-decay.md` §6 "Pasada
 * completa"). The aggregate `CuratorRun` carries the cap so that
 * findings can be raised against it.
 */
const DEFAULT_MAX_ENTRIES = 5000;

/**
 * Value object representing the per-kind entry caps supplied to a
 * curator run.
 *
 * The catalog is a one-cap-per-kind mapping, so callers can ask
 * `caps.forKind(kind)` and get a finite positive integer. Every kind
 * declared in `MemoryEntryKind.all()` MUST have an entry; the factory
 * fills missing kinds with the default to keep the invariant trivial
 * to maintain.
 *
 * Invariants:
 * - The internal record contains an entry for every value in
 *   `MemoryEntryKind.all()`.
 * - Each cap is a finite positive integer (`> 0`). Zero would forbid
 *   inserting any entry of that kind, which is not the intent.
 * - Instances are immutable; the internal record is frozen.
 */
export class MaxEntriesPerKind {
  private constructor(
    private readonly caps: Readonly<Record<MemoryEntryKindKind, number>>,
  ) {}

  /**
   * Returns the default-filled `MaxEntriesPerKind` (every kind set to
   * `DEFAULT_MAX_ENTRIES`).
   */
  public static default(): MaxEntriesPerKind {
    const filled: Record<MemoryEntryKindKind, number> = {
      decision: DEFAULT_MAX_ENTRIES,
      learning: DEFAULT_MAX_ENTRIES,
      entity: DEFAULT_MAX_ENTRIES,
      task: DEFAULT_MAX_ENTRIES,
      turn: DEFAULT_MAX_ENTRIES,
    };
    return new MaxEntriesPerKind(Object.freeze(filled));
  }

  /**
   * Builds a `MaxEntriesPerKind` from a partial map. Any kind missing
   * from `overrides` is filled with `DEFAULT_MAX_ENTRIES`. Validates
   * every supplied count.
   */
  public static of(
    overrides: Partial<Record<MemoryEntryKindKind, number>>,
  ): MaxEntriesPerKind {
    const filled: Record<MemoryEntryKindKind, number> = {
      decision: DEFAULT_MAX_ENTRIES,
      learning: DEFAULT_MAX_ENTRIES,
      entity: DEFAULT_MAX_ENTRIES,
      task: DEFAULT_MAX_ENTRIES,
      turn: DEFAULT_MAX_ENTRIES,
    };
    const knownKinds = MemoryEntryKind.all();
    for (const kind of knownKinds) {
      const candidate = overrides[kind];
      if (candidate === undefined) continue;
      MaxEntriesPerKind.assertPositiveInteger(kind, candidate);
      filled[kind] = candidate;
    }
    return new MaxEntriesPerKind(Object.freeze(filled));
  }

  /**
   * Returns the cap for the given kind. Always returns a finite
   * positive integer.
   */
  public forKind(kind: MemoryEntryKind): number {
    return this.caps[kind.toString()];
  }

  /**
   * Returns the underlying map as a frozen record. Useful for
   * adapters that need to serialize the catalog (for instance, when
   * persisting the run config alongside the run record).
   */
  public toRecord(): Readonly<Record<MemoryEntryKindKind, number>> {
    return this.caps;
  }

  public equals(other: MaxEntriesPerKind): boolean {
    if (this === other) return true;
    const knownKinds = MemoryEntryKind.all();
    for (const kind of knownKinds) {
      if (this.caps[kind] !== other.caps[kind]) return false;
    }
    return true;
  }

  // -- internals -----------------------------------------------------------

  private static assertPositiveInteger(
    kind: MemoryEntryKindKind,
    value: number,
  ): void {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(
        `max entries cap for kind "${kind}" must be a finite number`,
        { field: `max_entries_per_kind.${kind}` },
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError(
        `max entries cap for kind "${kind}" must be an integer`,
        { field: `max_entries_per_kind.${kind}` },
      );
    }
    if (value <= 0) {
      throw new InvalidInputError(
        `max entries cap for kind "${kind}" must be strictly positive (got: ${String(value)})`,
        { field: `max_entries_per_kind.${kind}` },
      );
    }
  }
}
