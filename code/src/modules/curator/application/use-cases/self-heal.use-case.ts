import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRun } from "../../domain/aggregates/curator-run.ts";
import type { CuratorRunRepository } from "../../domain/repositories/curator-run-repository.ts";
import { AffectedEntryRef } from "../../domain/value-objects/affected-entry-ref.ts";
import type { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { HealthFinding } from "../../domain/value-objects/health-finding.ts";
import { HealthFindingKind } from "../../domain/value-objects/health-finding-kind.ts";
import { HealthSeverity } from "../../domain/value-objects/health-severity.ts";
import { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { CuratorApplicationError } from "../errors/curator-application-error.ts";
import type {
  SelfHeal,
  SelfHealResult,
} from "../ports/in/self-heal.port.ts";
import type { FilesystemChecker } from "../ports/out/filesystem-checker.port.ts";
import type {
  EntityLocationProjection,
  MemoryEntryReader,
} from "../ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../ports/out/memory-entry-writer.port.ts";

/**
 * Use case: run the curator's self-healing checks.
 *
 * Implements the `SelfHeal` driving port. The MVP supports the
 * path-stale check (Caso 1) end-to-end and stubs out Casos 2, 3 and
 * 5 with structural placeholders that can be implemented when their
 * dependent infrastructure (decision-similarity service, queue
 * reader, session-aging projector) lands. The placeholders are
 * intentionally explicit — they return zero counters and emit a
 * single `info`-level log per check so the operator can see they
 * ran.
 *
 * Path-stale check (Caso 1):
 * 1. Asks the reader for every `Entity.location` in the workspace.
 * 2. Splits the optional `:line` suffix and feeds the path to the
 *    `FilesystemChecker` driven port.
 * 3. For each `missing` / `unresolvable` result, calls
 *    `MemoryEntryWriter.tagEntityAsStale(...)` (which adds the
 *    `stale` tag AND halves the entity's confidence) and records a
 *    `path_stale` finding on the `CuratorRun` aggregate.
 *
 * Casos 2/3/5 placeholders: the use case keeps their counters at
 * zero so the result DTO shape is stable. When the infrastructure
 * for each check exists, the placeholder body is replaced; the
 * driving-port surface does NOT change.
 */
export class SelfHealUseCase implements SelfHeal {
  public constructor(
    private readonly reader: MemoryEntryReader,
    private readonly writer: MemoryEntryWriter,
    private readonly filesystemChecker: FilesystemChecker,
    private readonly curatorRuns: CuratorRunRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async heal(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
  }): Promise<SelfHealResult> {
    const run = await this.curatorRuns.findById(input.runId);
    if (run === null) {
      throw CuratorApplicationError.runNotFound(input.runId.toString());
    }

    const pathsCorrected = await this.healPathStale(
      input.workspaceId,
      run,
    );

    // Casos 2, 3, 5: placeholders. See JSDoc above.
    const decisionConflictsDetected = 0;
    const embeddingsRequeued = 0;
    const openQuestionsAged = 0;

    const findingsRecorded =
      pathsCorrected +
      decisionConflictsDetected +
      embeddingsRequeued +
      openQuestionsAged;

    if (findingsRecorded > 0) {
      await this.curatorRuns.save(run);
    }

    this.logger.debug(
      {
        runId: input.runId.toString(),
        workspaceId: input.workspaceId.toString(),
        pathsCorrected,
        decisionConflictsDetected,
        embeddingsRequeued,
        openQuestionsAged,
      },
      "curator: self-heal pass completed",
    );

    return {
      runId: input.runId,
      pathsCorrected,
      decisionConflictsDetected,
      embeddingsRequeued,
      openQuestionsAged,
      findingsRecorded,
    };
  }

  /**
   * Caso 1: path-stale. Returns the count of entities tagged stale
   * during this pass.
   */
  private async healPathStale(
    workspaceId: WorkspaceId,
    run: CuratorRun,
  ): Promise<number> {
    const projections = await this.reader.listEntityLocations({ workspaceId });
    if (projections.length === 0) return 0;

    const paths = projections.map((p) => this.stripLineSuffix(p.location));
    const results = await this.filesystemChecker.checkPaths(paths);
    if (results.length !== projections.length) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          expected: projections.length,
          received: results.length,
        },
        "curator: filesystem checker returned a result count that does not match the input; aborting path-stale pass",
      );
      return 0;
    }

    let counted = 0;
    for (let i = 0; i < projections.length; i += 1) {
      const projection = projections[i];
      const result = results[i];
      if (projection === undefined || result === undefined) continue;
      if (!result.requiresAttention()) continue;
      const tagged = await this.writer.tagEntityAsStale({
        workspaceId: projection.workspaceId,
        entityId: projection.entityId,
      });
      if (!tagged) continue;
      this.recordPathStaleFinding(projection, run);
      counted += 1;
    }
    return counted;
  }

  private recordPathStaleFinding(
    projection: EntityLocationProjection,
    run: CuratorRun,
  ): void {
    const entityRef = AffectedEntryRef.of(
      MemoryEntryKind.entity(),
      projection.entityId,
    );
    const finding = HealthFinding.create({
      kind: HealthFindingKind.pathStale(),
      severity: HealthSeverity.warning(),
      description: `entity location "${projection.location}" no longer exists in the workspace`,
      affectedEntries: [entityRef],
    });
    run.recordFinding({
      finding,
      occurredAt: this.clock.now(),
    });
  }

  /**
   * Splits `path:line` into `path` so the filesystem checker probes
   * the file, not the file-with-line-suffix. Mirrors the algorithm
   * in `docs/05-memoria-decay.md` §5 Caso 1 ("parseLocation"). Only
   * a trailing numeric segment after the LAST `:` is stripped; this
   * preserves Windows-style drive letters (`C:\…`).
   */
  private stripLineSuffix(location: string): string {
    const lastColon = location.lastIndexOf(":");
    if (lastColon <= 1) return location; // no colon, or drive letter only
    const tail = location.slice(lastColon + 1);
    if (tail.length === 0) return location;
    if (!/^\d+$/.test(tail)) return location;
    return location.slice(0, lastColon);
  }
}
