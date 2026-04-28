import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { LearningId } from "./learning-id.ts";

/**
 * Value object representing the list of `Learning` ids referenced from
 * a `Turn`.
 *
 * Mirrors the `turns.learnings_json TEXT NOT NULL DEFAULT '[]'` column
 * documented in `docs/03-modelo-datos.md` §4.2. The recall layer (Capa
 * 5, `docs/04-capas-contexto.md` §3.5) follows these links to surface
 * learnings whose recording turn is being recalled.
 *
 * Invariants:
 * - Every entry is a non-null `LearningId`.
 * - No duplicate ids (compared by `equals`).
 * - The internal array is frozen and never mutated; mutation produces a
 *   new instance.
 *
 * Equality:
 * - Two `LinkedLearningIds` are equal iff they contain the same ids in
 *   the same order. Order matters because the wire payload preserves
 *   the order in which the learnings were captured during the turn.
 */
export class LinkedLearningIds {
  private constructor(private readonly values: readonly LearningId[]) {}

  public static empty(): LinkedLearningIds {
    return new LinkedLearningIds(Object.freeze<LearningId[]>([]));
  }

  public static create(raw: readonly LearningId[]): LinkedLearningIds {
    const normalised: LearningId[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const candidate = raw[i];
      if (candidate === undefined) {
        throw new InvalidInputError(
          `learnings[${String(i)}] must be a LearningId`,
          { field: `learnings[${String(i)}]` },
        );
      }
      for (const existing of normalised) {
        if (existing.equals(candidate)) {
          throw new InvalidInputError(
            `duplicate learning id in turn linkage: "${candidate.toString()}"`,
            { field: `learnings[${String(i)}]` },
          );
        }
      }
      normalised.push(candidate);
    }
    return new LinkedLearningIds(Object.freeze(normalised));
  }

  public size(): number {
    return this.values.length;
  }

  public isEmpty(): boolean {
    return this.values.length === 0;
  }

  public contains(id: LearningId): boolean {
    for (const existing of this.values) {
      if (existing.equals(id)) return true;
    }
    return false;
  }

  /**
   * Returns the ids as a frozen, read-only array.
   */
  public toArray(): readonly LearningId[] {
    return this.values;
  }

  public equals(other: LinkedLearningIds): boolean {
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
