import { Id } from "../../../../shared/domain/value-objects/id.ts";
import type { MemoryEntryKind } from "./memory-entry-kind.ts";

/**
 * Value object pairing a memory `kind` with the canonical id of an
 * affected entry.
 *
 * The curator domain often needs to refer to an entry without
 * importing the concrete aggregate id type. For example, a
 * `HealthFinding` of kind `decision_conflict` carries two affected
 * entries (the two clashing decisions), and the same finding type can
 * also report a clash inside `entities`. Modelling the reference as a
 * `(kind, id)` pair keeps the curator free of conditional imports
 * while still preserving the kind discriminator the application layer
 * needs to dispatch back to the right repository.
 *
 * The id is stored as the canonical UUID v7 string (validated through
 * the shared `Id` factory). This is the same format the `pruned`
 * table uses for `original_id` (`docs/03-modelo-datos.md` §4.9), so
 * the persistence adapter can round-trip without any additional
 * mapping.
 *
 * Invariants:
 * - `kind` is a valid `MemoryEntryKind`.
 * - `id` is a normalised UUID v7 string.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `AffectedEntryRef` are equal iff both `kind` and `id` match.
 */
export class AffectedEntryRef {
  private constructor(
    public readonly kind: MemoryEntryKind,
    public readonly id: string,
  ) {}

  /**
   * Builds an `AffectedEntryRef` from a kind and a raw id string.
   * The id is validated and lowercased through the shared `Id`
   * factory — invalid UUIDs are rejected here, before the reference
   * is ever persisted.
   */
  public static of(kind: MemoryEntryKind, rawId: string): AffectedEntryRef {
    const validated = Id.create<"curator-affected-entry">(
      rawId,
      "affected_entry_id",
    );
    return new AffectedEntryRef(kind, validated.toString());
  }

  public equals(other: AffectedEntryRef): boolean {
    if (this === other) return true;
    return this.kind.equals(other.kind) && this.id === other.id;
  }
}
