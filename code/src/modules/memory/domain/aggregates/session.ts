import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { NonMonotonicActivityError } from "../errors/non-monotonic-activity-error.ts";
import { SessionAlreadyEndedError } from "../errors/session-already-ended-error.ts";
import { SessionIdleTimeoutExceededError } from "../errors/session-idle-timeout-exceeded-error.ts";
import { SessionEnded } from "../events/session-ended.ts";
import { SessionOpenQuestionAdded } from "../events/session-open-question-added.ts";
import { SessionOpenQuestionResolved } from "../events/session-open-question-resolved.ts";
import { SessionStarted } from "../events/session-started.ts";
import type { OpenQuestionText } from "../value-objects/open-question.ts";
import { OpenQuestion } from "../value-objects/open-question.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { SessionIntent } from "../value-objects/session-intent.ts";
import { SessionMetadata } from "../value-objects/session-metadata.ts";
import type { SessionNextSeed } from "../value-objects/session-next-seed.ts";
import type { SessionSummary } from "../value-objects/session-summary.ts";
import { TurnsCount } from "../value-objects/turns-count.ts";

/**
 * Default idle-timeout window for a session, in milliseconds (30 min).
 *
 * Matches the `session_idle_timeout_min` default documented in
 * `docs/03-modelo-datos.md` §3 and the runtime behaviour in
 * `docs/01-arquitectura.md` §2.5 ("Si pasaron > 30 min sin tool calls:
 * la sesion anterior se cierra automaticamente"). The aggregate
 * accepts a smaller value when the workspace overrides the default;
 * the constant exists so the test layer and the application defaults
 * agree on the canonical value.
 */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS: number = 30 * 60 * 1000;

/**
 * Aggregate root for the `Session` kind of memory entry.
 *
 * Mirrors the `sessions` table documented in `docs/03-modelo-datos.md`
 * §4.1 in full. A session is the implicit grouping of turns within an
 * active window: the first tool call after `idleTimeoutMs` of
 * inactivity implicitly closes the previous session and starts a new
 * one (`docs/01-arquitectura.md` §2.5).
 *
 * The aggregate models the lifecycle and the rolling fields the
 * curator and recall layers need:
 *
 * - `start(...)` records the start instant. Optional `intent` and
 *   `resumedFrom` link to the user's stated goal and to the previous
 *   session's `next_seed` (chain pattern,
 *   `docs/03-modelo-datos.md` §4.1).
 * - `recordActivity(at)` extends the active window AND increments
 *   `turnsCount`. It refuses timestamps older than the previous
 *   activity and refuses to extend a session past its idle threshold
 *   — the application layer is then expected to call `end(...)` on
 *   the stale session and `start(...)` on a fresh one.
 * - `addOpenQuestion(text, at)` / `resolveOpenQuestion(text, at)`
 *   maintain the `metadata.openQuestions` list that powers Capa 7
 *   (Open Questions, `docs/04-capas-contexto.md` §3.7).
 * - `setSummary(...)` / `setNextSeed(...)` capture the rolling
 *   summary and the seed for the next session
 *   (`docs/01-arquitectura.md` §2.5: "El 'summary' de la sesion
 *   cerrada se genera concatenando los `record_*` acumulados").
 * - `end(at)` closes the session, emitting `SessionEnded` with the
 *   final `summary`, `nextSeed`, and `turnsCount`. Once closed, the
 *   aggregate refuses any further mutation.
 *
 * Invariants:
 * - Identity is immutable.
 * - `endedAt !== null` => the session is closed; any further mutation
 *   raises `SessionAlreadyEndedError`.
 * - `lastActivityAt` is monotonic: each `recordActivity` and `end`
 *   must supply a timestamp greater than or equal to the previous
 *   one.
 * - `idleTimeoutMs > 0`. The factory rejects non-positive values and
 *   `rehydrate` re-validates so corrupt persisted state surfaces at
 *   load time.
 * - `turnsCount` is monotonic: it only grows via `recordActivity`.
 * - The same open-question text never appears twice in
 *   `metadata.openQuestions` (enforced by `SessionMetadata`).
 */
export class Session {
  private readonly id: SessionId;
  private readonly workspaceId: WorkspaceId;
  private readonly startedAt: Timestamp;
  private endedAt: Timestamp | null;
  private lastActivityAt: Timestamp;
  private readonly idleTimeoutMs: number;
  private intent: SessionIntent | null;
  private summary: SessionSummary | null;
  private nextSeed: SessionNextSeed | null;
  private readonly resumedFrom: SessionId | null;
  private turnsCount: TurnsCount;
  private metadata: SessionMetadata;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: SessionId;
    workspaceId: WorkspaceId;
    startedAt: Timestamp;
    endedAt: Timestamp | null;
    lastActivityAt: Timestamp;
    idleTimeoutMs: number;
    intent: SessionIntent | null;
    summary: SessionSummary | null;
    nextSeed: SessionNextSeed | null;
    resumedFrom: SessionId | null;
    turnsCount: TurnsCount;
    metadata: SessionMetadata;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.startedAt = input.startedAt;
    this.endedAt = input.endedAt;
    this.lastActivityAt = input.lastActivityAt;
    this.idleTimeoutMs = input.idleTimeoutMs;
    this.intent = input.intent;
    this.summary = input.summary;
    this.nextSeed = input.nextSeed;
    this.resumedFrom = input.resumedFrom;
    this.turnsCount = input.turnsCount;
    this.metadata = input.metadata;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Session` into existence. The session starts
   * with `lastActivityAt === startedAt` (the start itself counts as
   * activity), `turnsCount === 0`, and an empty `metadata`.
   *
   * Emits `SessionStarted`.
   *
   * Validation:
   * - `idleTimeoutMs` must be a positive integer.
   *
   * Optional inputs:
   * - `intent`: stated goal of the session, surfaced by Capa 1 of the
   *   context bundle.
   * - `resumedFrom`: previous session whose `next_seed` is being
   *   continued (chain pattern).
   * - `idleTimeoutMs`: defaults to `DEFAULT_SESSION_IDLE_TIMEOUT_MS`.
   */
  public static start(input: {
    id: SessionId;
    workspaceId: WorkspaceId;
    startedAt: Timestamp;
    intent?: SessionIntent | null;
    resumedFrom?: SessionId | null;
    idleTimeoutMs?: number;
  }): Session {
    const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
    Session.validateIdleTimeout(idleTimeoutMs);
    const intent = input.intent ?? null;
    const resumedFrom = input.resumedFrom ?? null;
    const event = new SessionStarted({
      workspaceId: input.workspaceId,
      sessionId: input.id,
      intent,
      resumedFrom,
      occurredAt: input.startedAt,
    });
    return new Session({
      id: input.id,
      workspaceId: input.workspaceId,
      startedAt: input.startedAt,
      endedAt: null,
      lastActivityAt: input.startedAt,
      idleTimeoutMs,
      intent,
      summary: null,
      nextSeed: null,
      resumedFrom,
      turnsCount: TurnsCount.zero(),
      metadata: SessionMetadata.empty(),
      events: [event],
    });
  }

  /**
   * Rehydrates a `Session` from previously-persisted state. Does NOT
   * emit any event. Re-validates `idleTimeoutMs` so corrupt persisted
   * data surfaces at load time rather than at first use.
   */
  public static rehydrate(input: {
    id: SessionId;
    workspaceId: WorkspaceId;
    startedAt: Timestamp;
    endedAt: Timestamp | null;
    lastActivityAt: Timestamp;
    idleTimeoutMs: number;
    intent: SessionIntent | null;
    summary: SessionSummary | null;
    nextSeed: SessionNextSeed | null;
    resumedFrom: SessionId | null;
    turnsCount: TurnsCount;
    metadata: SessionMetadata;
  }): Session {
    Session.validateIdleTimeout(input.idleTimeoutMs);
    return new Session({
      id: input.id,
      workspaceId: input.workspaceId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      lastActivityAt: input.lastActivityAt,
      idleTimeoutMs: input.idleTimeoutMs,
      intent: input.intent,
      summary: input.summary,
      nextSeed: input.nextSeed,
      resumedFrom: input.resumedFrom,
      turnsCount: input.turnsCount,
      metadata: input.metadata,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Extends the session's active window with a new activity timestamp
   * and increments `turnsCount`.
   *
   * Refuses:
   * - sessions that have already ended (`SessionAlreadyEndedError`);
   * - timestamps older than `lastActivityAt`
   *   (`NonMonotonicActivityError`);
   * - timestamps that imply the session has already gone past its
   *   idle window (`SessionIdleTimeoutExceededError`).
   *
   * Does NOT emit a domain event: the activity itself is recorded by
   * the entry that triggered it (e.g. `TurnRecorded`,
   * `DecisionRecorded`). Emitting another event here would be noise.
   * The bumped `turnsCount`, however, is observable via the
   * subsequent `SessionEnded` payload (and via the live aggregate
   * state, of course).
   */
  public recordActivity(at: Timestamp): void {
    this.assertOpen();
    this.assertMonotonic(at);
    const idleMillis = at.diff(this.lastActivityAt);
    if (idleMillis > this.idleTimeoutMs) {
      throw new SessionIdleTimeoutExceededError({
        sessionId: this.id,
        idleMillis,
        idleTimeoutMillis: this.idleTimeoutMs,
      });
    }
    this.lastActivityAt = at;
    this.turnsCount = this.turnsCount.increment();
  }

  /**
   * Adds an open question to the session's metadata. The call is
   * idempotent: adding a question whose text already exists is a
   * no-op (`SessionMetadata.withOpenQuestionAdded` returns the same
   * instance) and no event is emitted.
   *
   * Emits `SessionOpenQuestionAdded` when a new question is recorded.
   */
  public addOpenQuestion(input: {
    text: OpenQuestionText;
    occurredAt: Timestamp;
  }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    if (this.metadata.hasOpenQuestion(input.text)) {
      return;
    }
    const question = OpenQuestion.of(input.text, input.occurredAt);
    this.metadata = this.metadata.withOpenQuestionAdded(question);
    this.lastActivityAt = input.occurredAt;
    this.events.push(
      new SessionOpenQuestionAdded({
        workspaceId: this.workspaceId,
        sessionId: this.id,
        text: input.text,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Removes an open question from the session's metadata. The call
   * is idempotent: resolving a question whose text is not present is
   * a no-op and no event is emitted.
   *
   * Emits `SessionOpenQuestionResolved` when a question is removed.
   */
  public resolveOpenQuestion(input: {
    text: OpenQuestionText;
    occurredAt: Timestamp;
  }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    if (!this.metadata.hasOpenQuestion(input.text)) {
      return;
    }
    this.metadata = this.metadata.withOpenQuestionResolved(input.text);
    this.lastActivityAt = input.occurredAt;
    this.events.push(
      new SessionOpenQuestionResolved({
        workspaceId: this.workspaceId,
        sessionId: this.id,
        text: input.text,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Sets (or replaces) the session's rolling summary. The summary
   * is typically authored by the curator at close time but the
   * contract allows mid-session updates if the application chooses to
   * stream incremental summaries.
   *
   * Does NOT emit a dedicated event: the closing `SessionEnded`
   * payload carries the final value, which is what subscribers need
   * for Capa 7 / Capa 4 rendering.
   */
  public setSummary(input: {
    summary: SessionSummary;
    occurredAt: Timestamp;
  }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    this.summary = input.summary;
    this.lastActivityAt = input.occurredAt;
  }

  /**
   * Sets (or replaces) the session's `next_seed`: the hint a future
   * session will pick up via `resumed_from`. Like `setSummary`, this
   * does not emit a dedicated event — the closing `SessionEnded`
   * payload carries the final value.
   */
  public setNextSeed(input: {
    nextSeed: SessionNextSeed;
    occurredAt: Timestamp;
  }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    this.nextSeed = input.nextSeed;
    this.lastActivityAt = input.occurredAt;
  }

  /**
   * Sets (or replaces) the session's `intent`. Useful when the user
   * declares the goal mid-session (the start factory accepts the
   * intent up front, but the chain `mem.session_force` then
   * `mem.intent` is also legal).
   */
  public setIntent(input: {
    intent: SessionIntent;
    occurredAt: Timestamp;
  }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    this.intent = input.intent;
    this.lastActivityAt = input.occurredAt;
  }

  /**
   * Closes the session. Refuses to close an already-closed session
   * (the application layer is expected to call `isEnded()` first if
   * idempotency is desired). Emits `SessionEnded` with the final
   * `summary`, `nextSeed`, and `turnsCount`.
   */
  public end(input: { occurredAt: Timestamp }): void {
    this.assertOpen();
    this.assertMonotonic(input.occurredAt);
    this.endedAt = input.occurredAt;
    this.lastActivityAt = input.occurredAt;
    this.events.push(
      new SessionEnded({
        workspaceId: this.workspaceId,
        sessionId: this.id,
        summary: this.summary,
        nextSeed: this.nextSeed,
        turnsCount: this.turnsCount,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  /**
   * True iff `now` is more than `idleTimeoutMs` after the last
   * activity. Read-only check used by the application layer to decide
   * whether to rotate the session before processing the next call.
   */
  public isIdle(now: Timestamp): boolean {
    if (this.endedAt !== null) return true;
    const idleMillis = now.diff(this.lastActivityAt);
    return idleMillis > this.idleTimeoutMs;
  }

  public isEnded(): boolean {
    return this.endedAt !== null;
  }

  public getId(): SessionId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getStartedAt(): Timestamp {
    return this.startedAt;
  }

  public getEndedAt(): Timestamp | null {
    return this.endedAt;
  }

  public getLastActivityAt(): Timestamp {
    return this.lastActivityAt;
  }

  public getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  public getIntent(): SessionIntent | null {
    return this.intent;
  }

  public getSummary(): SessionSummary | null {
    return this.summary;
  }

  public getNextSeed(): SessionNextSeed | null {
    return this.nextSeed;
  }

  public getResumedFrom(): SessionId | null {
    return this.resumedFrom;
  }

  public getTurnsCount(): TurnsCount {
    return this.turnsCount;
  }

  public getMetadata(): SessionMetadata {
    return this.metadata;
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  // -- internals -----------------------------------------------------------

  /**
   * Throws `SessionAlreadyEndedError` if the session has been closed.
   * Single-source-of-truth gate for every mutation.
   */
  private assertOpen(): void {
    if (this.endedAt !== null) {
      throw new SessionAlreadyEndedError(this.id);
    }
  }

  /**
   * Throws `NonMonotonicActivityError` if `at` is older than the last
   * recorded activity. Single-source-of-truth check for every
   * mutation that advances the session timeline.
   */
  private assertMonotonic(at: Timestamp): void {
    if (at.isBefore(this.lastActivityAt)) {
      throw new NonMonotonicActivityError({
        sessionId: this.id,
        previousActivityMs: this.lastActivityAt.toEpochMs(),
        attemptedActivityMs: at.toEpochMs(),
      });
    }
  }

  private static validateIdleTimeout(value: number): void {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(
        "session idle timeout must be a finite number",
        { field: "idle_timeout_ms" },
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError(
        "session idle timeout must be an integer number of milliseconds",
        { field: "idle_timeout_ms" },
      );
    }
    if (value <= 0) {
      throw new InvalidInputError(
        "session idle timeout must be strictly positive",
        { field: "idle_timeout_ms" },
      );
    }
  }
}
