import type { Timestamp } from "../../domain/value-objects/timestamp.ts";

/**
 * Driven (output) port for "what time is it now?".
 *
 * Why this lives in `shared/application/ports/`:
 * - `Timestamp` is a transversal value object (`shared/domain/value-
 *   objects/timestamp.ts`); every module needs to obtain the current
 *   instant to stamp domain events, sessions, decisions, curator
 *   runs, audit entries, etc. Per `docs/12-lineamientos-arquitectura.md`
 *   §1.5 Regla 3 the port goes here.
 *
 * Why this matters (DDD):
 * - The domain is forbidden from calling `Date.now()` directly: it
 *   would couple every aggregate to the system clock, making the
 *   domain non-deterministic and untestable.
 * - The `Timestamp` VO already documents this contract in its JSDoc:
 *   "The factory `now(clockMs)` requires the current time as a
 *   parameter so that the domain stays free of `Date.now()` calls.
 *   The composition root injects a `Clock` port that supplies the
 *   value." This file IS that port.
 *
 * Implementation expectations (per Fase 2 task `2.2-shared-infrastructure`):
 * - `shared/infrastructure/time/system-clock.ts` implements `now()` as
 *   `Timestamp.now(Date.now())` and `nowMs()` as `Date.now()`.
 *
 * Test doubles (live in `tests/fixtures/`):
 * - `FixedClock(timestamp)` always returns the same `Timestamp`. Used
 *   by deterministic tests of aggregates that record `recordedAt`,
 *   `lastUsedAt`, etc.
 * - `AdvanceableClock(initial)` exposes `advance(ms)` so a test can
 *   simulate the passage of time (e.g. session-idle-timeout, decay
 *   curves over 30/60/90 days). Used by curator-domain tests.
 */
export interface Clock {
  /**
   * Returns the current instant as a domain-level `Timestamp`.
   *
   * Use this when handing the value to an aggregate or VO factory
   * that already speaks `Timestamp` (the vast majority of call sites).
   */
  now(): Timestamp;

  /**
   * Returns the current instant as raw epoch milliseconds.
   *
   * Use this when measuring an internal duration (e.g. tool latency
   * for `mem.health` stats, p50/p95 timings) where wrapping the
   * number in a `Timestamp` would be ceremony with no benefit.
   *
   * Invariants:
   * - The returned value MUST be consistent with `now().toEpochMs()`
   *   when called back-to-back; the ordering of two consecutive
   *   readings MUST be monotonic non-decreasing within the same
   *   process. (System wall clocks can jump backwards on NTP sync;
   *   adapters that need monotonicity for SLO measurements should
   *   layer `performance.now()` semantics on top of this port — but
   *   the contract here is wall-clock.)
   */
  nowMs(): number;
}
