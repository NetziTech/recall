import type { Clock } from "../../application/ports/clock.port.ts";
import { Timestamp } from "../../domain/value-objects/timestamp.ts";

/**
 * Adapter that fulfils the {@link Clock} port using
 * `Date.now()` as the wall-clock source.
 *
 * Why a class (no parameters) instead of a free function:
 * - The composition root injects this object by reference into every
 *   use case that needs `now()`. A plain `Date.now()` import would
 *   force every consumer to know about the global clock and would
 *   make tests need module-level mocking.
 * - The class layout makes substitution trivial: the test composition
 *   root can pass a `FakeClock` instead.
 *
 * Composition root example:
 * ```typescript
 * const clock: Clock = new SystemClock();
 * const useCase = new RememberDecisionUseCase(repo, idGenerator, clock, logger);
 * ```
 */
export class SystemClock implements Clock {
  public now(): Timestamp {
    return Timestamp.now(Date.now());
  }

  public nowMs(): number {
    return Date.now();
  }
}
