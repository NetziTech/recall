import type { IdGenerator } from "../../application/ports/id-generator.port.ts";
import { Id } from "../../domain/value-objects/id.ts";
import { InvalidInputError } from "../../domain/errors/invalid-input-error.ts";

/**
 * Construction options for {@link FakeIdGenerator}.
 *
 * Two mutually-exclusive modes:
 * - **Sequence mode**: pass `sequence` to feed pre-built UUID v7
 *   strings. The generator yields them in order; once exhausted, every
 *   subsequent call throws.
 * - **Counter mode** (default): pass `seed` (defaults to 1) and the
 *   generator emits a deterministic series:
 *     `00000000-0000-7000-8000-000000000001`
 *     `00000000-0000-7000-8000-000000000002`
 *     ...
 *   The pattern preserves the canonical UUID v7 shape (the version
 *   nibble is `7`, the variant nibble is `8` — both come from the
 *   `0000-7000-8000` prefix) so the strings round-trip through
 *   `Id.create()` without rejection.
 *
 * Both fields cannot be provided at once: the constructor throws if
 * `sequence` is non-empty AND `seed` is also provided, to make the
 * intent unambiguous at construction time.
 */
export interface FakeIdGeneratorOptions {
  readonly seed?: number | undefined;
  readonly sequence?: readonly string[] | undefined;
}

/**
 * Deterministic test double for the {@link IdGenerator} port.
 *
 * Why this lives in `shared/infrastructure/` (not `tests/fixtures/`):
 * - Same rationale as {@link import("../clock/fake-clock.ts").FakeClock}:
 *   every module's tests need a deterministic id source, so co-locating
 *   with the real adapter keeps the team's mental model simple. The
 *   composition root never imports this class — `validate-modules.ts`
 *   and Vitest coverage thresholds keep it out of production wiring.
 *
 * Counter-mode example:
 * ```typescript
 * const idGen = new FakeIdGenerator(); // seed=1
 * idGen.generateString(); // "00000000-0000-7000-8000-000000000001"
 * idGen.generateString(); // "00000000-0000-7000-8000-000000000002"
 * ```
 *
 * Sequence-mode example:
 * ```typescript
 * const idGen = new FakeIdGenerator({
 *   sequence: [
 *     "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
 *     "01952f3c-2222-7000-8000-aaaaaaaaaaaa",
 *   ],
 * });
 * useCase.execute(...); // first id from sequence
 * useCase.execute(...); // second id from sequence
 * useCase.execute(...); // throws — sequence exhausted
 * ```
 */
export class FakeIdGenerator implements IdGenerator {
  /** UUID-v7 fixed prefix used by counter mode. */
  private static readonly COUNTER_PREFIX = "00000000-0000-7000-8000-";

  private readonly mode: "counter" | "sequence";
  private counter: number;
  private readonly sequence: readonly string[];
  private sequenceIndex: number;

  public constructor(options: FakeIdGeneratorOptions = {}) {
    const seed = options.seed;
    const sequence = options.sequence;

    if (
      sequence !== undefined &&
      sequence.length > 0 &&
      seed !== undefined
    ) {
      throw new InvalidInputError(
        "FakeIdGenerator: pass either `seed` or `sequence`, not both",
        { field: "sequence" },
      );
    }

    if (sequence !== undefined && sequence.length > 0) {
      // Validate every sequence entry up front so failure surfaces at
      // construction (where the test author can see it) rather than on
      // the Nth call.
      for (const candidate of sequence) {
        FakeIdGenerator.assertCanonicalUuidV7(candidate);
      }
      this.mode = "sequence";
      this.sequence = sequence;
      this.sequenceIndex = 0;
      this.counter = 0;
    } else {
      this.mode = "counter";
      this.counter = seed ?? 1;
      if (!Number.isInteger(this.counter) || this.counter < 0) {
        throw new InvalidInputError(
          "FakeIdGenerator: seed must be a non-negative integer",
          { field: "seed" },
        );
      }
      this.sequence = [];
      this.sequenceIndex = 0;
    }
  }

  public generate<TBrand extends string>(): Id<TBrand> {
    return Id.create<TBrand>(this.generateString());
  }

  public generateString(): string {
    if (this.mode === "sequence") {
      const value = this.sequence[this.sequenceIndex];
      if (value === undefined) {
        throw new InvalidInputError(
          `FakeIdGenerator: sequence exhausted after ${String(this.sequenceIndex)} ids`,
        );
      }
      this.sequenceIndex += 1;
      return value;
    }
    // counter mode
    const value = this.formatCounter(this.counter);
    this.counter += 1;
    return value;
  }

  private formatCounter(n: number): string {
    if (n < 0 || n > 0xff_ff_ff_ff_ff_ff) {
      throw new InvalidInputError(
        `FakeIdGenerator: counter overflow (max 12 hex digits, got ${String(n)})`,
        { field: "seed" },
      );
    }
    // The 12-character last group of a UUID is the natural place to
    // encode the sequence number. Pad to 12 hex digits.
    const tail = n.toString(16).padStart(12, "0");
    return `${FakeIdGenerator.COUNTER_PREFIX}${tail}`;
  }

  private static assertCanonicalUuidV7(candidate: string): void {
    // Run through `Id.create` so the validation logic stays in one
    // place; we discard the resulting Id (we only care about the
    // throw/no-throw semantics).
    Id.create(candidate, "FakeIdGenerator.sequence entry");
  }
}
