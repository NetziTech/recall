/**
 * Cross-module facade adapters that wrap module use cases in the
 * `cli` driving ports (`*Facade.port.ts` in `modules/cli/application/ports/out/`).
 *
 * Why these adapters live in `composition/`:
 * - The `cli` module declares the facade ports precisely so it does
 *   not import from workspace/encryption/secrets/curator. The
 *   composition root is the only place allowed to wire both sides.
 *
 * Coverage matrix (Fase 4):
 *
 *   | Facade group              | Status                                           |
 *   |---------------------------|--------------------------------------------------|
 *   | `workspace-facade.port`   | Wired against the workspace module's use cases.  |
 *   | `encryption-facade.port`  | Stubs — `export-key`, `rekey`, `add-key` flows   |
 *   |                           |   need the multi-key v0.5+ flow that does not    |
 *   |                           |   exist yet in the encryption module.           |
 *   | `secrets-facade.port`     | Wired against the secrets module's use cases    |
 *   |                           |   (`InstallPreCommitHook`, `Sanitize`).         |
 *   |                           |   `audit` is partially stubbed (memory-module   |
 *   |                           |   scan absent).                                 |
 *   | `curator-facade.port`     | Wired against the curator's `RunCuratorUseCase`. |
 *   | `maintenance-facade.port` | Stubs — `import-handoff`, `export`, `import`,   |
 *   |                           |   `wipe`, `stats`, `server` need orchestration  |
 *   |                           |   the memory module does not provide yet.       |
 *
 * The wired facades let the CLI binary execute the workspace
 * lifecycle commands (`init`, `mode`, `unlock`, `forget-key`,
 * `health`, `curator-run`, `curator-log`, `install-hook`,
 * `uninstall-hook`, `sanitize`) end-to-end. The stubbed maintenance
 * commands surface a typed failure so the user gets a clean
 * "feature pending" message.
 */

import * as path from "node:path";

import * as fs from "node:fs/promises";

import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { CuratorRunTrigger } from "../../modules/curator/domain/value-objects/curator-run-trigger.ts";
import type { RunCurator } from "../../modules/curator/application/ports/in/run-curator.port.ts";
import type { SqliteCuratorRunRepository } from "../../modules/curator/infrastructure/persistence/sqlite-curator-run-repository.ts";
import type { AuditMemory } from "../../modules/memory/application/ports/in/audit-memory.port.ts";
import type { ExportMemory } from "../../modules/memory/application/ports/in/export-memory.port.ts";
import type {
  ImportConflictStrategy,
  ImportMemory,
} from "../../modules/memory/application/ports/in/import-memory.port.ts";
import type { ImportHandoff } from "../../modules/memory/application/ports/in/import-handoff.port.ts";
import type { StatsMemory } from "../../modules/memory/application/ports/in/stats-memory.port.ts";
import type { Workspace } from "../../modules/workspace/domain/aggregates/workspace.ts";
import type { WorkspaceMode } from "../../modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceMode as WorkspaceModeClass } from "../../modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../modules/workspace/domain/value-objects/workspace-path.ts";
import { DisplayName } from "../../modules/workspace/domain/value-objects/display-name.ts";
import type { EmbedderSpec } from "../../modules/workspace/domain/value-objects/embedder-spec.ts";
import type { ChangeMode } from "../../modules/workspace/application/ports/in/change-mode.port.ts";
import type { DestroyWorkspace } from "../../modules/workspace/application/ports/in/destroy-workspace.port.ts";
import type { DetectWorkspace } from "../../modules/workspace/application/ports/in/detect-workspace.port.ts";
import type { HealthCheck } from "../../modules/workspace/application/ports/in/health-check.port.ts";
import type { InitializeWorkspace } from "../../modules/workspace/application/ports/in/initialize-workspace.port.ts";
import type { LockWorkspace } from "../../modules/workspace/application/ports/in/lock-workspace.port.ts";
import type { UnlockWorkspace } from "../../modules/workspace/application/ports/in/unlock-workspace.port.ts";
import type { InstallPreCommitHook } from "../../modules/secrets/application/ports/in/install-pre-commit-hook.port.ts";
import type { SanitizePath } from "../../modules/secrets/application/ports/in/sanitize-path.port.ts";
import { isErr } from "../../shared/domain/types/result.ts";

import type {
  AddKeyFacade,
  AddKeyFacadeInput,
  AddKeyFacadeOutput,
  ExportKeyFacade,
  ExportKeyFacadeInput,
  ExportKeyFacadeOutput,
  RekeyFacade,
  RekeyFacadeInput,
  RekeyFacadeOutput,
} from "../../modules/cli/application/ports/out/encryption-facade.port.ts";
import type {
  ChangeModeFacade,
  ChangeModeFacadeInput,
  ChangeModeFacadeOutput,
  HealthCheckFacade,
  HealthCheckFacadeInput,
  HealthCheckFacadeOutput,
  InitializeWorkspaceFacade as CliInitializeWorkspaceFacade,
  InitializeWorkspaceFacadeInput,
  InitializeWorkspaceFacadeOutput,
  LockWorkspaceFacade,
  LockWorkspaceFacadeInput,
  LockWorkspaceFacadeOutput,
  UnlockWorkspaceFacade,
  UnlockWorkspaceFacadeInput,
  UnlockWorkspaceFacadeOutput,
  WorkspaceModeWire,
} from "../../modules/cli/application/ports/out/workspace-facade.port.ts";
import type {
  AuditFacade,
  AuditFacadeInput,
  AuditFacadeOutput,
  InstallHookFacade,
  InstallHookFacadeInput,
  InstallHookFacadeOutput,
  SanitizeFacade,
  SanitizeFacadeInput,
  SanitizeFacadeOutput,
  UninstallHookFacade,
  UninstallHookFacadeInput,
  UninstallHookFacadeOutput,
} from "../../modules/cli/application/ports/out/secrets-facade.port.ts";
import type {
  CuratorLogFacade,
  CuratorLogFacadeInput,
  CuratorLogFacadeOutput,
  CuratorRunFacade,
  CuratorRunFacadeInput,
  CuratorRunFacadeOutput,
} from "../../modules/cli/application/ports/out/curator-facade.port.ts";
import type {
  ExportFacade,
  ExportFacadeInput,
  ExportFacadeOutput,
  ImportFacade,
  ImportFacadeInput,
  ImportFacadeOutput,
  ImportHandoffFacade,
  ImportHandoffFacadeInput,
  ImportHandoffFacadeOutput,
  ServerFacade,
  ServerFacadeInput,
  ServerFacadeOutput,
  StatsFacade,
  StatsFacadeInput,
  StatsFacadeOutput,
  WipeFacade,
  WipeFacadeInput,
  WipeFacadeOutput,
} from "../../modules/cli/application/ports/out/maintenance-facade.port.ts";

/**
 * Tagged error used by every stub facade in this file so the CLI's
 * `RunCliCommandUseCase` can map it to a deterministic exit code.
 */
export class CliFacadeNotImplementedError extends Error {
  public readonly code = "composition.cli-facade-pending";

  public constructor(facade: string, reason: string) {
    super(
      `${facade} is not implemented yet (Fase 4 dispute; ${reason}; see composition/facades/cli-facades.ts).`,
    );
    this.name = "CliFacadeNotImplementedError";
  }
}

// ─── Workspace facades ──────────────────────────────────────────────────

/**
 * Adapter for the CLI's `InitializeWorkspaceFacade`. Wraps the
 * workspace `InitializeWorkspaceUseCase` and translates plain
 * primitives ↔ workspace-domain VOs at the boundary.
 */
export class CliInitializeWorkspaceFacadeAdapter
  implements CliInitializeWorkspaceFacade
{
  public constructor(
    private readonly useCase: InitializeWorkspace,
    private readonly defaultEmbedder: EmbedderSpec,
  ) {}

  public async initialize(
    input: InitializeWorkspaceFacadeInput,
  ): Promise<InitializeWorkspaceFacadeOutput> {
    const result = await this.useCase.initialize({
      rootPath: WorkspacePath.create(input.rootPath),
      mode: WorkspaceModeClass.create(input.mode),
      displayName: DisplayName.create(input.displayName),
      embedder: this.defaultEmbedder,
      passphrase: input.passphrase,
    });
    const workspace = result.workspace;
    return {
      workspaceId: workspace.getId().toString(),
      mode: modeToWire(workspace.getMode()),
      wasCreated: result.wasCreated,
    };
  }
}

/**
 * Adapter for the CLI's `UnlockWorkspaceFacade`.
 */
export class CliUnlockWorkspaceFacadeAdapter implements UnlockWorkspaceFacade {
  public constructor(private readonly useCase: UnlockWorkspace) {}

  public async unlock(
    input: UnlockWorkspaceFacadeInput,
  ): Promise<UnlockWorkspaceFacadeOutput> {
    const result = await this.useCase.unlock({
      rootPath: WorkspacePath.create(input.rootPath),
      passphrase: input.passphrase,
    });
    return {
      workspaceId: result.workspace.getId().toString(),
      wasUnlocked: result.wasUnlocked,
      mode: modeToWire(result.workspace.getMode()),
    };
  }
}

/**
 * Adapter for the CLI's `LockWorkspaceFacade`.
 */
export class CliLockWorkspaceFacadeAdapter implements LockWorkspaceFacade {
  public constructor(private readonly useCase: LockWorkspace) {}

  public async lock(
    input: LockWorkspaceFacadeInput,
  ): Promise<LockWorkspaceFacadeOutput> {
    const result = await this.useCase.lock({
      rootPath: WorkspacePath.create(input.rootPath),
    });
    return {
      workspaceId: result.workspace.getId().toString(),
      wasLocked: result.wasLocked,
    };
  }
}

/**
 * Adapter for the CLI's `ChangeModeFacade`.
 */
export class CliChangeModeFacadeAdapter implements ChangeModeFacade {
  public constructor(private readonly useCase: ChangeMode) {}

  public async change(
    input: ChangeModeFacadeInput,
  ): Promise<ChangeModeFacadeOutput> {
    const result = await this.useCase.change({
      rootPath: WorkspacePath.create(input.rootPath),
      newMode: WorkspaceModeClass.create(input.newMode),
      passphrase: input.passphrase,
    });
    return {
      workspaceId: result.workspace.getId().toString(),
      newMode: modeToWire(result.workspace.getMode()),
    };
  }
}

/**
 * Adapter for the CLI's `HealthCheckFacade`.
 */
export class CliHealthCheckFacadeAdapter implements HealthCheckFacade {
  public constructor(private readonly useCase: HealthCheck) {}

  public async check(
    input: HealthCheckFacadeInput,
  ): Promise<HealthCheckFacadeOutput> {
    const result = await this.useCase.check({
      rootPath: WorkspacePath.create(input.rootPath),
    });
    return {
      checks: result.checks.map((entry) => ({
        id: entry.id,
        status: entry.status,
        message: entry.message,
      })),
      healthy: result.healthy,
    };
  }
}

// ─── Encryption facades (stubs) ─────────────────────────────────────────

/**
 * Stub for `ExportKeyFacade`. The encryption module does not yet
 * expose the "re-print the master key once" flow; the master key is
 * a transient process-local secret that lives in `MasterKey` VO and
 * is wiped on first use. Surfacing it again would require either:
 *   (a) caching the printable form during init, or
 *   (b) a deterministic key-from-passphrase derivation the
 *       encryption module's KDF does not provide (intentional).
 *
 * The decision belongs to the architect (`docs/11 §3`) — for Fase 4
 * the facade throws.
 */
export class PendingExportKeyFacade implements ExportKeyFacade {
  public export(_input: ExportKeyFacadeInput): Promise<ExportKeyFacadeOutput> {
    return Promise.reject(
      new CliFacadeNotImplementedError(
        "ExportKeyFacade",
        "no master-key recovery path implemented yet",
      ),
    );
  }
}

/**
 * Stub for `RekeyFacade`. Requires the multi-envelope flow that is
 * part of v0.5 (`docs/11 §7 — Multi-key`).
 */
export class PendingRekeyFacade implements RekeyFacade {
  public rekey(_input: RekeyFacadeInput): Promise<RekeyFacadeOutput> {
    return Promise.reject(
      new CliFacadeNotImplementedError(
        "RekeyFacade",
        "rekey requires the multi-key (v0.5) flow",
      ),
    );
  }
}

/**
 * Stub for `AddKeyFacade`. Same reason as rekey — multi-key v0.5.
 */
export class PendingAddKeyFacade implements AddKeyFacade {
  public add(_input: AddKeyFacadeInput): Promise<AddKeyFacadeOutput> {
    return Promise.reject(
      new CliFacadeNotImplementedError(
        "AddKeyFacade",
        "add-key requires the multi-key (v0.5) flow",
      ),
    );
  }
}

// ─── Secrets facades ────────────────────────────────────────────────────

/**
 * Adapter for `InstallHookFacade`. Forwards to the secrets module's
 * `InstallPreCommitHookUseCase` and surfaces the install timestamp
 * the CLI prints to stdout.
 */
export class CliInstallHookFacadeAdapter implements InstallHookFacade {
  public constructor(
    private readonly useCase: InstallPreCommitHook,
    private readonly logger: Logger,
  ) {}

  public async install(
    input: InstallHookFacadeInput,
  ): Promise<InstallHookFacadeOutput> {
    const result = await this.useCase.install({ workspaceRoot: input.rootPath });
    if (isErr(result)) {
      // PathSanitizerError → typed CLI error. Log and rethrow as a
      // domain-tier failure for the runner.
      this.logger.warn(
        { kind: result.error.kind },
        "install-hook rejected by path sanitizer",
      );
      throw result.error;
    }
    return { installedAt: new Date().toISOString() };
  }
}

/**
 * Stub for `UninstallHookFacade`. The secrets module does not yet
 * expose an uninstall use case; the `FilesystemPreCommitHookInstaller`
 * adapter could grow one but the work belongs to the secrets module.
 */
export class PendingUninstallHookFacade implements UninstallHookFacade {
  public uninstall(
    _input: UninstallHookFacadeInput,
  ): Promise<UninstallHookFacadeOutput> {
    return Promise.reject(
      new CliFacadeNotImplementedError(
        "UninstallHookFacade",
        "secrets module needs an uninstall use case",
      ),
    );
  }
}

/**
 * Adapter for `SanitizeFacade`. Currently delegates to
 * `SanitizePathUseCase` for the entry-id path resolution; the
 * heavier "redact persisted ciphertext" flow lives in the memory
 * module which has no application/infrastructure layers yet, so the
 * facade applies path sanitisation only and reports the result.
 */
export class CliSanitizeFacadeAdapter implements SanitizeFacade {
  public constructor(private readonly useCase: SanitizePath) {}

  public sanitize(input: SanitizeFacadeInput): Promise<SanitizeFacadeOutput> {
    const result = this.useCase.sanitize(input.entryId);
    if (isErr(result)) {
      return Promise.reject(result.error);
    }
    return Promise.resolve({
      entryId: input.entryId,
      redactedPaths: Object.freeze([result.value.toString()]),
    });
  }
}

/**
 * Adapter for `AuditFacade`. Forwards to the memory module's
 * `AuditMemoryUseCase`. Detects the workspace via `DetectWorkspace`
 * so the user does not have to type the workspace id by hand.
 *
 * Severity translation: the memory use case returns `"info" |
 * "warn" | "error"`; the CLI wire shape uses `"info" | "warn" |
 * "critical"` (the tail two words diverge). The adapter normalises
 * `"error" → "critical"` so the CLI's coloured table renders
 * red issues consistently.
 *
 * The `checkSecrets` and `strict` flags are forwarded as no-ops
 * for now; the audit use case is read-only and the secrets-aware
 * second pass lands in Fase 5+ (no concrete tracker yet — the
 * memory audit alone is sufficient for the MVP `mcp-memoria audit`
 * command).
 */
export class CliAuditFacadeAdapter implements AuditFacade {
  public constructor(
    private readonly useCase: AuditMemory,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async audit(input: AuditFacadeInput): Promise<AuditFacadeOutput> {
    void input.checkSecrets;
    void input.strict;
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "AuditFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const result = await this.useCase.audit({
      workspaceId: detection.workspace.getId(),
    });
    const findings = result.issues.map((issue) => ({
      id: issue.entryRef === null ? issue.code : issue.entryRef.id,
      kind: issue.entryRef === null ? "audit" : issue.entryRef.kind,
      severity: severityToCliSeverity(issue.severity),
      summary: issue.message,
    }));
    const hasCritical = findings.some((finding) => finding.severity === "critical");
    return {
      findings: Object.freeze(findings),
      hasCritical,
    };
  }
}

// ─── Curator facades ────────────────────────────────────────────────────

/**
 * Adapter for `CuratorRunFacade`. Forwards to the curator's
 * `RunCuratorUseCase` with the `manual` trigger.
 */
export class CliCuratorRunFacadeAdapter implements CuratorRunFacade {
  public constructor(
    private readonly useCase: RunCurator,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async run(input: CuratorRunFacadeInput): Promise<CuratorRunFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "CuratorRunFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const result = await this.useCase.run({
      workspaceId: detection.workspace.getId(),
      trigger: CuratorRunTrigger.manual(),
    });
    const stats = result.stats;
    return {
      runId: result.runId.toString(),
      entriesScanned: stats.getEntriesScanned(),
      entriesPruned: stats.getEntriesPruned(),
      learningsConsolidated: stats.getLearningsConsolidated(),
      durationMs: stats.getDurationMs(),
    };
  }
}

/**
 * Adapter for `CuratorLogFacade`. Reads the most recent curator run
 * rows via the repository.
 */
export class CliCuratorLogFacadeAdapter implements CuratorLogFacade {
  public constructor(
    private readonly repository: SqliteCuratorRunRepository,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async log(input: CuratorLogFacadeInput): Promise<CuratorLogFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      return { entries: Object.freeze([]) };
    }
    const limit = input.last ?? 10;
    const runs = await this.repository.findRecentByWorkspace(
      detection.workspace.getId(),
      limit,
    );
    const entries = runs.map((run) => {
      const endedAt = run.getEndedAt();
      return {
        runId: run.getId().toString(),
        trigger: run.getTrigger().toString(),
        startedAtMs: run.getStartedAt().toEpochMs(),
        endedAtMs: endedAt === null ? null : endedAt.toEpochMs(),
        entriesScanned: run.getStats().getEntriesScanned(),
        entriesPruned: run.getStats().getEntriesPruned(),
      };
    });
    return { entries: Object.freeze(entries) };
  }
}

// ─── Maintenance facades ────────────────────────────────────────────────

/**
 * Adapter for `ImportHandoffFacade`. Reads the `HANDOFF.md` payload
 * from disk (the wire field is a path) and forwards to the memory
 * module's `ImportHandoffUseCase`.
 */
export class CliImportHandoffFacadeAdapter implements ImportHandoffFacade {
  public constructor(
    private readonly useCase: ImportHandoff,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async importHandoff(
    input: ImportHandoffFacadeInput,
  ): Promise<ImportHandoffFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "ImportHandoffFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const markdown = await fs.readFile(input.handoffPath, "utf8");
    const result = await this.useCase.import({
      workspaceId: detection.workspace.getId(),
      markdown,
    });
    return {
      importedDecisions: result.counts.decisions,
      importedLearnings: result.counts.learnings,
      skippedSections: result.skipped.length,
    };
  }
}

/**
 * Adapter for `ExportFacade`. Forwards to the memory module's
 * `ExportMemoryUseCase` and writes the resulting JSON to disk.
 */
export class CliExportFacadeAdapter implements ExportFacade {
  public constructor(
    private readonly useCase: ExportMemory,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async export(input: ExportFacadeInput): Promise<ExportFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "ExportFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const result = await this.useCase.export({
      workspaceId: detection.workspace.getId(),
    });
    const buffer = Buffer.from(result.json, "utf8");
    await fs.writeFile(input.outputPath, buffer);
    return {
      outputPath: input.outputPath,
      bytesWritten: buffer.byteLength,
    };
  }
}

/**
 * Adapter for `ImportFacade`. Reads the JSON payload from disk and
 * forwards to the memory module's `ImportMemoryUseCase` with the
 * conservative `skip` conflict strategy (the CLI does not expose a
 * `--strategy` flag yet; the operator can re-run with `replace` once
 * the memory module's CLI parser grows the option).
 */
export class CliImportFacadeAdapter implements ImportFacade {
  public constructor(
    private readonly useCase: ImportMemory,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async import(input: ImportFacadeInput): Promise<ImportFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "ImportFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const json = await fs.readFile(input.inputPath, "utf8");
    const conflictStrategy: ImportConflictStrategy = "skip";
    const result = await this.useCase.import({
      workspaceId: detection.workspace.getId(),
      json,
      conflictStrategy,
    });
    const importedRows =
      result.counts.decisions +
      result.counts.learnings +
      result.counts.entities +
      result.counts.tasks +
      result.counts.turns +
      result.counts.sessions +
      result.counts.relations;
    return {
      inputPath: input.inputPath,
      importedRows,
    };
  }
}

/**
 * Adapter for `WipeFacade`. Forwards to the workspace module's
 * `DestroyWorkspaceUseCase`, which orchestrates:
 *
 *   1. Encryption lock (for encrypted workspaces, before the
 *      directory disappears).
 *   2. SQL truncation via the memory wipe facade.
 *   3. Filesystem removal of the entire `.mcp-memoria/` directory
 *      tree (Tarea 5.3 — Bug 2 fix; the previous implementation
 *      truncated SQL but left the directory intact).
 *   4. `WorkspaceDestroyed` event emission.
 *
 * The CLI parser is the layer that enforces the `WIPE` literal
 * confirmation prompt or the `--confirm` flag; this adapter trusts
 * the `confirmed` flag and forwards it to the use case, which
 * applies its own defense-in-depth check.
 */
export class CliWipeFacadeAdapter implements WipeFacade {
  public constructor(private readonly useCase: DestroyWorkspace) {}

  public async wipe(input: WipeFacadeInput): Promise<WipeFacadeOutput> {
    const result = await this.useCase.destroy({
      rootPath: WorkspacePath.create(input.rootPath),
      confirmed: input.confirmed,
    });
    return {
      removedPath: result.removedPath,
    };
  }
}

/**
 * Adapter for `StatsFacade`. Forwards to the memory module's
 * `StatsMemoryUseCase` and projects the result onto the CLI wire
 * shape. The wire fields the memory aggregate cannot fill alone
 * (`embeddingsQueued`, `diskBytes`, `lastCuratorRunMs`) are zeroed
 * — the curator wiring exposes them in Fase 5+ via the `mem.health`
 * envelope.
 */
export class CliStatsFacadeAdapter implements StatsFacade {
  public constructor(
    private readonly useCase: StatsMemory,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async stats(input: StatsFacadeInput): Promise<StatsFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "StatsFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const result = await this.useCase.stats({
      workspaceId: detection.workspace.getId(),
    });
    return {
      decisions: result.counts.decisions,
      learnings: result.counts.learnings,
      entities: result.counts.entities,
      tasks: result.counts.tasks,
      turns: result.counts.turns,
      sessions: result.counts.sessions,
      embeddingsQueued: 0,
      diskBytes: 0,
      lastCuratorRunMs: null,
    };
  }
}

/**
 * Stub for `ServerFacade`. The CLI's `server` command starts the
 * MCP stdio loop; the bootstrap entrypoint already exposes a
 * `mcp-server-entrypoint` binary, so the recommended path is to
 * invoke it directly. Wiring the bootstrap path through the CLI is
 * deferred — this is intentionally a sub-process orchestration job
 * better solved at the binary boundary.
 */
export class PendingServerFacade implements ServerFacade {
  public start(_input: ServerFacadeInput): Promise<ServerFacadeOutput> {
    return Promise.reject(
      new CliFacadeNotImplementedError(
        "ServerFacade",
        "use the dedicated mcp-memoria-server binary instead",
      ),
    );
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────

function modeToWire(mode: WorkspaceMode): WorkspaceModeWire {
  if (mode.isShared()) return "shared";
  if (mode.isEncrypted()) return "encrypted";
  return "private";
}

/**
 * Translates the memory module's audit severity (`info | warn |
 * error`) into the CLI's wire severity (`info | warn | critical`).
 * The bottom two literals match; only `error → critical` flips.
 */
function severityToCliSeverity(
  severity: "info" | "warn" | "error",
): "info" | "warn" | "critical" {
  if (severity === "error") return "critical";
  return severity;
}

/**
 * Helper exported for tests / future maintenance commands that need
 * a canonical `.mcp-memoria/` path inside a workspace root.
 */
export function workspaceMemoriaDir(rootPath: string): string {
  return path.join(rootPath, ".mcp-memoria");
}

/**
 * Tagged error sentinel for CLI handlers that try to invoke a
 * facade against a Workspace they could not detect. Re-exported from
 * the workspace handler chain so the bootstrap can reuse it for
 * recovery messaging if needed.
 */
export function workspaceFromDetection(
  result: { readonly found: false } | { readonly found: true; readonly workspace: Workspace },
): Workspace | null {
  return result.found ? result.workspace : null;
}
