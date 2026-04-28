import type { Clock } from "../../application/ports/clock.port.ts";
import { Timestamp } from "../../domain/value-objects/timestamp.ts";

/**
 * Construction options for {@link FakeClock}.
 *
 * - `initialMs` — epoch milliseconds the clock starts at. Must be a
 *   non-negative integer; the underlying {@link Timestamp.fromEpochMs}
 *   factory rejects anything else.
 */
export interface FakeClockOptions {
  readonly initialMs: number;
}

/**
 * Deterministic test double for the {@link Clock} port.
 *
 * Why this lives in `shared/infrastructure/` (not `tests/fixtures/`):
 * - Multiple test suites across modules need it (workspace, memory,
 *   curator, retrieval all care about decay curves and session-idle
 *   timeouts). Co-locating with the real adapter keeps both
 *   implementations under one folder, which is the convention used by
 *   `docs/12-lineamientos-arquitectura.md` §2 ("Repositorios concretos
 *   y test doubles viven en `infrastructure/persistence/`").
 * - The class is harmless in production: the composition root never
 *   imports it, and `validate-modules.ts` plus the Vitest coverage
 *   thresholds prevent it from being wired by accident.
 *
 * Time-travel API:
 * - {@link FakeClock.advance} adds milliseconds, returning the new
 *   `Timestamp` for fluent assertions.
 * - {@link FakeClock.set} jumps to an absolute instant — used to test
 *   pre-conditions like "session goes idle 30 minutes after its last
 *   turn".
 *
 * Invariants:
 * - The internal `epochMs` is always a non-negative integer (the
 *   {@link Timestamp.fromEpochMs} factory enforces this on every
 *   transition).
 *
 * Example:
 * ```typescript
 * const clock = new FakeClock({ initialMs: 1_700_000_000_000 });
 * const useCase = new RecordTurnUseCase(repo, idGen, clock, logger);
 * await useCase.execute({...});
 * clock.advance(31 * 60 * 1000); // 31 minutes
 * await sessionIdleSweeper.run(clock.now());
 * ```
 */
export class FakeClock implements Clock {
  private currentMs: number;

  public constructor(options: FakeClockOptions) {
    // Run the value through the VO factory so we share the same
    // validation as the production path.
    const t = Timestamp.fromEpochMs(options.initialMs);
    this.currentMs = t.toEpochMs();
  }

  public now(): Timestamp {
    return Timestamp.fromEpochMs(this.currentMs);
  }

  public nowMs(): number {
    return this.currentMs;
  }

  /**
   * Advances the clock by `deltaMs` milliseconds. `deltaMs` must keep
   * the resulting time non-negative.
   */
  public advance(deltaMs: number): Timestamp {
    const next = Timestamp.fromEpochMs(this.currentMs + deltaMs);
    this.currentMs = next.toEpochMs();
    return next;
  }

  /**
   * Jumps the clock to `epochMs`. Useful when a test needs to land on
   * a specific anchor (e.g. a fixed creation timestamp for a snapshot).
   */
  public set(epochMs: number): Timestamp {
    const next = Timestamp.fromEpochMs(epochMs);
    this.currentMs = next.toEpochMs();
    return next;
  }
}
