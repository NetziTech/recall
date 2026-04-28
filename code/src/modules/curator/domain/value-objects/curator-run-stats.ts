import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Counter fields that travel with a `CuratorRunStats`. Centralised in
 * a type so both the constructor input and the wire-shape stay in
 * sync. Every counter mirrors a column in `curator_runs` documented in
 * `docs/03-modelo-datos.md` §4.11 (with a couple of additions this
 * module needs to track for self-healing — `pathsCorrected` and
 * `openQuestionsAged`).
 */
export interface CuratorRunStatsInput {
  readonly entriesScanned: number;
  readonly entriesDecayed: number;
  readonly entriesPruned: number;
  readonly learningsConsolidated: number;
  readonly pathsCorrected: number;
  readonly embeddingsRequeued: number;
  readonly openQuestionsAged: number;
  readonly durationMs: number;
}

/**
 * Value object capturing the metrics produced by a single curator
 * run.
 *
 * Mirrors the metrics block written to `curator_runs`
 * (`docs/03-modelo-datos.md` §4.11 / `docs/05-memoria-decay.md` §9).
 * Every counter is non-negative and integer-valued. `durationMs` is
 * the wall-clock duration of the pass; the aggregate `CuratorRun`
 * also carries a `startedAt` / `endedAt` pair, so this number is
 * redundant on disk but useful in memory for fast reporting (avoids
 * a second `Timestamp.diff` at the call site).
 *
 * Invariants:
 * - All numeric fields are finite, non-negative integers.
 * - Instances are immutable. Updating a counter requires producing a
 *   new VO via `with(...)` (the curator typically builds the final
 *   stats object once at the end of the pass; the aggregate accepts
 *   intermediate updates only by replacing the whole VO).
 *
 * Equality:
 * - Two `CuratorRunStats` are equal iff every counter matches.
 */
export class CuratorRunStats {
  private constructor(private readonly counters: CuratorRunStatsInput) {}

  /**
   * Builds an "empty" stats object with every counter at zero.
   * Useful as the initial snapshot at `CuratorRun.start(...)`.
   */
  public static empty(): CuratorRunStats {
    return new CuratorRunStats({
      entriesScanned: 0,
      entriesDecayed: 0,
      entriesPruned: 0,
      learningsConsolidated: 0,
      pathsCorrected: 0,
      embeddingsRequeued: 0,
      openQuestionsAged: 0,
      durationMs: 0,
    });
  }

  /**
   * Builds a `CuratorRunStats` from raw counters. Validates each
   * field; throws `InvalidInputError` on the first offending value.
   */
  public static of(input: CuratorRunStatsInput): CuratorRunStats {
    CuratorRunStats.assertNonNegativeInteger(
      "entriesScanned",
      input.entriesScanned,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "entriesDecayed",
      input.entriesDecayed,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "entriesPruned",
      input.entriesPruned,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "learningsConsolidated",
      input.learningsConsolidated,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "pathsCorrected",
      input.pathsCorrected,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "embeddingsRequeued",
      input.embeddingsRequeued,
    );
    CuratorRunStats.assertNonNegativeInteger(
      "openQuestionsAged",
      input.openQuestionsAged,
    );
    CuratorRunStats.assertNonNegativeInteger("durationMs", input.durationMs);
    return new CuratorRunStats({
      entriesScanned: input.entriesScanned,
      entriesDecayed: input.entriesDecayed,
      entriesPruned: input.entriesPruned,
      learningsConsolidated: input.learningsConsolidated,
      pathsCorrected: input.pathsCorrected,
      embeddingsRequeued: input.embeddingsRequeued,
      openQuestionsAged: input.openQuestionsAged,
      durationMs: input.durationMs,
    });
  }

  /**
   * Returns a new `CuratorRunStats` with the supplied counters
   * overridden. Any field not present in `overrides` keeps its
   * current value.
   */
  public with(overrides: Partial<CuratorRunStatsInput>): CuratorRunStats {
    return CuratorRunStats.of({
      entriesScanned:
        overrides.entriesScanned ?? this.counters.entriesScanned,
      entriesDecayed:
        overrides.entriesDecayed ?? this.counters.entriesDecayed,
      entriesPruned:
        overrides.entriesPruned ?? this.counters.entriesPruned,
      learningsConsolidated:
        overrides.learningsConsolidated ?? this.counters.learningsConsolidated,
      pathsCorrected:
        overrides.pathsCorrected ?? this.counters.pathsCorrected,
      embeddingsRequeued:
        overrides.embeddingsRequeued ?? this.counters.embeddingsRequeued,
      openQuestionsAged:
        overrides.openQuestionsAged ?? this.counters.openQuestionsAged,
      durationMs: overrides.durationMs ?? this.counters.durationMs,
    });
  }

  // -- queries ------------------------------------------------------------

  public getEntriesScanned(): number {
    return this.counters.entriesScanned;
  }

  public getEntriesDecayed(): number {
    return this.counters.entriesDecayed;
  }

  public getEntriesPruned(): number {
    return this.counters.entriesPruned;
  }

  public getLearningsConsolidated(): number {
    return this.counters.learningsConsolidated;
  }

  public getPathsCorrected(): number {
    return this.counters.pathsCorrected;
  }

  public getEmbeddingsRequeued(): number {
    return this.counters.embeddingsRequeued;
  }

  public getOpenQuestionsAged(): number {
    return this.counters.openQuestionsAged;
  }

  public getDurationMs(): number {
    return this.counters.durationMs;
  }

  /**
   * Returns the underlying counters as a frozen record. Useful when
   * the persistence adapter needs to project the stats to columns
   * directly.
   */
  public toRecord(): Readonly<CuratorRunStatsInput> {
    return Object.freeze({ ...this.counters });
  }

  public equals(other: CuratorRunStats): boolean {
    if (this === other) return true;
    return (
      this.counters.entriesScanned === other.counters.entriesScanned &&
      this.counters.entriesDecayed === other.counters.entriesDecayed &&
      this.counters.entriesPruned === other.counters.entriesPruned &&
      this.counters.learningsConsolidated ===
        other.counters.learningsConsolidated &&
      this.counters.pathsCorrected === other.counters.pathsCorrected &&
      this.counters.embeddingsRequeued === other.counters.embeddingsRequeued &&
      this.counters.openQuestionsAged === other.counters.openQuestionsAged &&
      this.counters.durationMs === other.counters.durationMs
    );
  }

  // -- internals ----------------------------------------------------------

  private static assertNonNegativeInteger(
    field: keyof CuratorRunStatsInput,
    value: number,
  ): void {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(
        `curator run stats counter "${field}" must be a finite number`,
        { field },
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError(
        `curator run stats counter "${field}" must be an integer`,
        { field },
      );
    }
    if (value < 0) {
      throw new InvalidInputError(
        `curator run stats counter "${field}" must be non-negative (got: ${String(value)})`,
        { field },
      );
    }
  }
}
