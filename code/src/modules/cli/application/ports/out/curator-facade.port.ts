/**
 * Driven (output) facade ports toward the curator module's CLI-facing
 * use cases:
 *
 *   - `recall curator-run` — manual curator pass. Mirrors the
 *     `manual` trigger of `CuratorRun` (`docs/05-memoria-decay.md`).
 *   - `recall curator-log` — read the most recent runs from the
 *     `curator_runs` table.
 */

export interface CuratorRunFacadeInput {
  readonly rootPath: string;
  readonly dryRun: boolean;
}

export interface CuratorRunFacadeOutput {
  readonly runId: string;
  readonly entriesScanned: number;
  readonly entriesPruned: number;
  readonly learningsConsolidated: number;
  readonly durationMs: number;
}

export interface CuratorRunFacade {
  run(input: CuratorRunFacadeInput): Promise<CuratorRunFacadeOutput>;
}

export interface CuratorLogFacadeInput {
  readonly rootPath: string;
  readonly last: number | null;
}

export interface CuratorLogEntry {
  readonly runId: string;
  readonly trigger: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly entriesScanned: number;
  readonly entriesPruned: number;
}

export interface CuratorLogFacadeOutput {
  readonly entries: readonly CuratorLogEntry[];
}

export interface CuratorLogFacade {
  log(input: CuratorLogFacadeInput): Promise<CuratorLogFacadeOutput>;
}
