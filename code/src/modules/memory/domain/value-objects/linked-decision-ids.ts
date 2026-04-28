import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { DecisionId } from "./decision-id.ts";

/**
 * Value object representing the list of `Decision` ids referenced from
 * a `Turn`.
 *
 * Mirrors the `turns.decisions_json TEXT NOT NULL DEFAULT '[]'` column
 * documented in `docs/03-modelo-datos.md` §4.2. The recall layer (Capa
 * 5, `docs/04-capas-contexto.md` §3.5) follows these links to surface
 * decisions whose explanatory turn is being recalled, so the invariants
 * (uniqueness, no nulls, ordering preserved) need to live in the
 * domain.
 *
 * Invariants:
 * - Every entry is a non-null `DecisionId`.
 * - No duplicate ids (compared by `equals`).
 * - The internal array is frozen and never mutated; mutation produces a
 *   new instance.
 *
 * Equality:
 * - Two `LinkedDecisionIds` are equal iff they contain the same ids in
 *   the same order. Order matters because the wire payload preserves
 *   the order in which the assistant cited the decisions during the
 *   turn.
 */
export class LinkedDecisionIds {
  private constructor(private readonly values: readonly DecisionId[]) {}

  public static empty(): LinkedDecisionIds {
    return new LinkedDecisionIds(Object.freeze<DecisionId[]>([]));
  }

  public static create(raw: readonly DecisionId[]): LinkedDecisionIds {
    const normalised: DecisionId[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const candidate = raw[i];
      if (candidate === undefined) {
        throw new InvalidInputError(
          `decisions[${String(i)}] must be a DecisionId`,
          { field: `decisions[${String(i)}]` },
        );
      }
      for (const existing of normalised) {
        if (existing.equals(candidate)) {
          throw new InvalidInputError(
            `duplicate decision id in turn linkage: "${candidate.toString()}"`,
            { field: `decisions[${String(i)}]` },
          );
        }
      }
      normalised.push(candidate);
    }
    return new LinkedDecisionIds(Object.freeze(normalised));
  }

  public size(): number {
    return this.values.length;
  }

  public isEmpty(): boolean {
    return this.values.length === 0;
  }

  public contains(id: DecisionId): boolean {
    for (const existing of this.values) {
      if (existing.equals(id)) return true;
    }
    return false;
  }

  /**
   * Returns the ids as a frozen, read-only array.
   */
  public toArray(): readonly DecisionId[] {
    return this.values;
  }

  public equals(other: LinkedDecisionIds): boolean {
    if (this === other) return true;
    if (this.values.length !== other.values.length) return false;
    for (let i = 0; i < this.values.length; i += 1) {
      const a = this.values[i];
      const b = other.values[i];
      if (a === undefined || b === undefined) return false;
      if (!a.equals(b)) return false;
    }
    return true;
  }
}
