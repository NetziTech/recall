import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { CuratorRunAlreadyCompletedError } from "../errors/curator-run-already-completed-error.ts";
import { CuratorRunCompleted } from "../events/curator-run-completed.ts";
import { CuratorRunStarted } from "../events/curator-run-started.ts";
import { EntryPruned } from "../events/entry-pruned.ts";
import { HealthFindingDetected } from "../events/health-finding-detected.ts";
import { LearningsConsolidated } from "../events/learnings-consolidated.ts";
import { AffectedEntryRef } from "../value-objects/affected-entry-ref.ts";
import type { ConsolidationPair } from "../value-objects/consolidation-pair.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../value-objects/curator-run-stats.ts";
import type { CuratorRunTrigger } from "../value-objects/curator-run-trigger.ts";
import type { HealthFinding } from "../value-objects/health-finding.ts";
import type { MemoryEntryKind } from "../value-objects/memory-entry-kind.ts";
import type { PrunedReason } from "../value-objects/pruned-reason.ts";

/**
 * Aggregate root for a single execution of the curator's maintenance
 * pass.
 *
 * Mirrors the `curator_runs` table documented in
 * `docs/03-modelo-datos.md` §4.11 and the orchestration described in
 * `docs/05-memoria-decay.md` §6 ("Pasada completa"). One aggregate
 * instance corresponds to one row in `curator_runs` and to one
 * end-to-end pass over the workspace's data:
 *
 * 1. The application layer calls `CuratorRun.start(...)` and persists
 *    the (open) row.
 * 2. As the pass progresses, it calls `recordFinding`,
 *    `recordConsolidation`, `recordPrune`. Each mutation appends a
 *    domain event the application layer drains and forwards to its
 *    subscribers (logger, MCP responder).
 * 3. When the pass finishes, the application layer calls
 *    `complete(...)` with the final `CuratorRunStats` and persists
 *    the closed row. After completion the aggregate is immutable.
 *
 * Invariants:
 * - Identity is immutable: `getId()` is stable for the entire
 *   lifetime.
 * - The aggregate moves through exactly two states:
 *   `running` (between `start` and `complete`) and `completed`
 *   (after `complete`). The transition is one-way.
 * - `recordFinding`, `recordConsolidation`, `recordPrune` REFUSE to
 *   mutate a completed run (`CuratorRunAlreadyCompletedError`).
 * - `complete(at, finalStats)` enforces `at.epochMs >= startedAt.epochMs`.
 * - `findings`, `consolidations` and the running stats are
 *   monotonically growing — there is no "undo" operation. The
 *   curator either runs to completion or its row stays open and the
 *   next pass overwrites it.
 *
 * Persistence:
 * - The repository (`CuratorRunRepository`) reads/writes the basic
 *   columns (`id`, `workspaceId`, `trigger`, `startedAt`, `endedAt`,
 *   stats counters). Findings and consolidations are typically
 *   side-channelled into a structured logger (the schema does not
 *   yet declare per-finding columns; see
 *   `docs/03-modelo-datos.md` §4.11). The aggregate keeps both
 *   collections in memory so the run summary is readable when the
 *   trigger is `manual` (the JSON-RPC response surfaces them).
 * - Domain events buffered on the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after each `save` succeeds.
 */
export class CuratorRun {
  private readonly id: CuratorRunId;
  private readonly workspaceId: WorkspaceId;
  private readonly trigger: CuratorRunTrigger;
  private readonly startedAt: Timestamp;
  private endedAt: Timestamp | null;
  private stats: CuratorRunStats;
  private findings: HealthFinding[];
  private consolidations: ConsolidationPair[];
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: CuratorRunId;
    workspaceId: WorkspaceId;
    trigger: CuratorRunTrigger;
    startedAt: Timestamp;
    endedAt: Timestamp | null;
    stats: CuratorRunStats;
    findings: readonly HealthFinding[];
    consolidations: readonly ConsolidationPair[];
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.trigger = input.trigger;
    this.startedAt = input.startedAt;
    this.endedAt = input.endedAt;
    this.stats = input.stats;
    // Defensive copies: the constructor accepts `readonly` views but
    // owns mutable buffers internally so the recording mutators can
    // append.
    this.findings = [...input.findings];
    this.consolidations = [...input.consolidations];
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `CuratorRun` into existence. Use this exactly
   * once per pass, when the application layer has decided to kick
   * off the curator.
   *
   * Defaults:
   * - `endedAt`: `null` (the run is open).
   * - `stats`: empty (counters at zero).
   * - `findings` / `consolidations`: empty.
   *
   * Emits `CuratorRunStarted`.
   */
  public static start(input: {
    id: CuratorRunId;
    workspaceId: WorkspaceId;
    trigger: CuratorRunTrigger;
    occurredAt: Timestamp;
  }): CuratorRun {
    const event = new CuratorRunStarted({
      workspaceId: input.workspaceId,
      runId: input.id,
      trigger: input.trigger,
      occurredAt: input.occurredAt,
    });
    return new CuratorRun({
      id: input.id,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      startedAt: input.occurredAt,
      endedAt: null,
      stats: CuratorRunStats.empty(),
      findings: [],
      consolidations: [],
      events: [event],
    });
  }

  /**
   * Rehydrates a `CuratorRun` from previously-persisted state. Does
   * NOT emit any event (no business fact is happening).
   *
   * Validates the basic invariant `endedAt >= startedAt` so a corrupt
   * row cannot survive rehydration.
   */
  public static rehydrate(input: {
    id: CuratorRunId;
    workspaceId: WorkspaceId;
    trigger: CuratorRunTrigger;
    startedAt: Timestamp;
    endedAt: Timestamp | null;
    stats: CuratorRunStats;
    findings: readonly HealthFinding[];
    consolidations: readonly ConsolidationPair[];
  }): CuratorRun {
    if (input.endedAt?.isBefore(input.startedAt) === true) {
      throw new InvariantViolationError(
        `curator run ${input.id.toString()} cannot end before it starts`,
        { invariant: "curator.run.ended-after-started" },
      );
    }
    return new CuratorRun({
      id: input.id,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      stats: input.stats,
      findings: input.findings,
      consolidations: input.consolidations,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Appends a `HealthFinding` to the run. Refuses to mutate a
   * completed run.
   *
   * Emits `HealthFindingDetected`.
   */
  public recordFinding(input: {
    finding: HealthFinding;
    occurredAt: Timestamp;
  }): void {
    this.assertRunning();
    this.findings.push(input.finding);
    this.events.push(
      new HealthFindingDetected({
        workspaceId: this.workspaceId,
        runId: this.id,
        finding: input.finding,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Appends a `ConsolidationPair` recommendation to the run. Refuses
   * to mutate a completed run.
   *
   * Emits `LearningsConsolidated`. Note: the actual fold of the
   * underlying `Learning` aggregates is performed by the application
   * layer; this method only records the recommendation.
   */
  public recordConsolidation(input: {
    pair: ConsolidationPair;
    occurredAt: Timestamp;
  }): void {
    this.assertRunning();
    this.consolidations.push(input.pair);
    this.events.push(
      new LearningsConsolidated({
        workspaceId: this.workspaceId,
        runId: this.id,
        pair: input.pair,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Records that the curator pruned an entry of the given kind.
   * Refuses to mutate a completed run.
   *
   * Emits `EntryPruned`. Note: the actual delete-from-source +
   * insert-into-pruned movement is performed by the application
   * layer (driven by the event); this method only records the
   * intent.
   */
  public recordPrune(input: {
    kind: MemoryEntryKind;
    originalId: string;
    reason: PrunedReason;
    occurredAt: Timestamp;
  }): void {
    this.assertRunning();
    const ref = AffectedEntryRef.of(input.kind, input.originalId);
    this.events.push(
      new EntryPruned({
        workspaceId: this.workspaceId,
        runId: this.id,
        entryRef: ref,
        reason: input.reason,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Marks the run as complete. Stores the final stats and the
   * `endedAt` timestamp. After completion the aggregate is
   * immutable: any further `recordFinding` / `recordConsolidation`
   * / `recordPrune` raises `CuratorRunAlreadyCompletedError`.
   *
   * Refuses:
   * - re-completion (calling `complete` twice).
   * - `endedAt < startedAt` (time-travel).
   *
   * Emits `CuratorRunCompleted`.
   */
  public complete(input: {
    finalStats: CuratorRunStats;
    occurredAt: Timestamp;
  }): void {
    if (this.endedAt !== null) {
      throw new CuratorRunAlreadyCompletedError(this.id);
    }
    if (input.occurredAt.isBefore(this.startedAt)) {
      throw new InvariantViolationError(
        `curator run ${this.id.toString()} cannot end at ${String(input.occurredAt.toEpochMs())} before it started at ${String(this.startedAt.toEpochMs())}`,
        { invariant: "curator.run.ended-after-started" },
      );
    }
    this.endedAt = input.occurredAt;
    this.stats = input.finalStats;
    this.events.push(
      new CuratorRunCompleted({
        workspaceId: this.workspaceId,
        runId: this.id,
        stats: input.finalStats,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): CuratorRunId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getTrigger(): CuratorRunTrigger {
    return this.trigger;
  }

  public getStartedAt(): Timestamp {
    return this.startedAt;
  }

  public getEndedAt(): Timestamp | null {
    return this.endedAt;
  }

  public getStats(): CuratorRunStats {
    return this.stats;
  }

  /**
   * Returns a frozen snapshot of the recorded findings. Mutating the
   * returned array has no effect on the aggregate.
   */
  public getFindings(): readonly HealthFinding[] {
    return Object.freeze([...this.findings]);
  }

  /**
   * Returns a frozen snapshot of the recorded consolidation
   * recommendations. Mutating the returned array has no effect on
   * the aggregate.
   */
  public getConsolidations(): readonly ConsolidationPair[] {
    return Object.freeze([...this.consolidations]);
  }

  public isRunning(): boolean {
    return this.endedAt === null;
  }

  public isCompleted(): boolean {
    return this.endedAt !== null;
  }

  /**
   * Drains and returns the buffered events. Mirrors the contract of
   * the other aggregates in the codebase.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  // -- internals -----------------------------------------------------------

  private assertRunning(): void {
    if (this.endedAt !== null) {
      throw new CuratorRunAlreadyCompletedError(this.id);
    }
  }
}
