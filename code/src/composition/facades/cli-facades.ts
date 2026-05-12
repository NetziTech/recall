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
import type { ResetEmbeddingQueueUseCase } from "../../modules/retrieval/application/use-cases/reset-embedding-queue.use-case.ts";
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
import type { UninstallPreCommitHook } from "../../modules/secrets/application/ports/in/uninstall-pre-commit-hook.port.ts";
import type { SanitizePath } from "../../modules/secrets/application/ports/in/sanitize-path.port.ts";
import type { AddEnvelope } from "../../modules/encryption/application/ports/in/add-envelope.port.ts";
import type { ExportMasterKey } from "../../modules/encryption/application/ports/in/export-master-key.port.ts";
import type { RekeyEncryption } from "../../modules/encryption/application/ports/in/rekey-encryption.port.ts";
// UnlockEncryption is invoked internally by AddEnvelopeUseCase since the
// refactor that merged unlock + addEnvelope into a single use case (the
// aggregate's in-memory unlocked state cannot survive `findByWorkspace`).
// JSDoc references kept for documentation continuity.
import { KeyLabel } from "../../modules/encryption/domain/value-objects/key-label.ts";
import { Passphrase } from "../../modules/encryption/domain/value-objects/passphrase.ts";
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
  ResetQueueFacade,
  ResetQueueFacadeInput,
  ResetQueueFacadeOutput,
} from "../../modules/cli/application/ports/out/embedding-queue-facade.port.ts";
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
 * Cross-module facade adapter that fulfils the CLI's
 * {@link ExportKeyFacade} port using the encryption module's
 * {@link ExportMasterKey} use case.
 *
 * ADR-005 Q3 (Phase-22 appendix, `docs/12-lineamientos-arquitectura.md`
 * §1.5.5 Q3) + `docs/11-seguridad-modos.md` §3: the master key is
 * re-rendered as a Bech32 BIP-173 string (HRP `m3`, 61 chars + BCH
 * checksum) suitable for one-shot stdout display. The output is
 * stdout-only — NEVER through the MCP channel — and the use case
 * emits a single `ExportKeyEmitted` audit row per invocation.
 *
 * Flow:
 * 1. Detect the workspace at `rootPath` so the facade can resolve
 *    the canonical `WorkspaceId` without forcing the wire shape to
 *    carry one. Refuses with `CliFacadeNotImplementedError` if no
 *    workspace is found.
 * 2. Convert `currentPassphrase: string` into a `Passphrase` value
 *    object at the boundary (the VO trims whitespace and enforces
 *    the 12-char minimum).
 * 3. Invoke `ExportMasterKey.exportMasterKey(...)`. The use case
 *    orchestrates unlock + render + audit row internally.
 * 4. Project the typed output onto the wire shape, calling
 *    `printableMasterKey.toRenderedWithGrouping()` to produce the
 *    dash-grouped human-friendly form the CLI handler renders on
 *    stdout. The `PrintableMasterKey` VO reference is dropped at
 *    the end of this method; the GC reclaims the wrapped bytes
 *    soon after the rendered string is on the wire.
 */
export class CliExportKeyFacadeAdapter implements ExportKeyFacade {
  public constructor(
    private readonly exportMasterKeyUseCase: ExportMasterKey,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async export(
    input: ExportKeyFacadeInput,
  ): Promise<ExportKeyFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "ExportKeyFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const workspaceId = detection.workspace.getId();
    const currentPassphrase = Passphrase.from(input.currentPassphrase);

    const result = await this.exportMasterKeyUseCase.exportMasterKey({
      workspaceId,
      currentPassphrase,
    });

    return {
      workspaceId: workspaceId.toString(),
      printableMasterKey: result.printableMasterKey.toRenderedWithGrouping(),
      exportedAt: new Date(result.exportedAt.toEpochMs()).toISOString(),
    };
  }
}

/**
 * Cross-module facade adapter that fulfils the CLI's
 * {@link RekeyFacade} port using the encryption module's
 * {@link RekeyEncryption} use case.
 *
 * ADR-005 Q2 (Phase-22 appendix, `docs/12-lineamientos-arquitectura.md`
 * §1.5.5 Q2): rekey rotates the passphrase-envelope list under the
 * `addEnvelope(new) → verify → removeEnvelope(old)` pattern. The
 * master key is NOT rotated; the SQLCipher `PRAGMA rekey` is NOT
 * invoked. See the use case JSDoc for the documented limit ("rekey
 * does NOT mitigate a master-key compromise").
 *
 * Flow:
 * 1. Detect the workspace at `rootPath` so the facade can resolve
 *    the canonical `WorkspaceId` without forcing the wire shape to
 *    carry one.
 * 2. Convert wire primitives into value objects:
 *      - `currentPassphrase` / `newPassphrase` → `Passphrase.from(...)`
 *      - `label` → `KeyLabel.create(...)` (or `null` when absent)
 * 3. Invoke `RekeyEncryption.rekey(...)`. The use case orchestrates
 *    unlock + add + verify + remove + persist + audit chain.
 * 4. Project the typed output back onto the wire shape (strings,
 *    ISO-8601 timestamp).
 */
export class CliRekeyFacadeAdapter implements RekeyFacade {
  public constructor(
    private readonly rekeyUseCase: RekeyEncryption,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async rekey(input: RekeyFacadeInput): Promise<RekeyFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "RekeyFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const workspaceId = detection.workspace.getId();
    const currentPassphrase = Passphrase.from(input.currentPassphrase);
    const newPassphrase = Passphrase.from(input.newPassphrase);
    const label =
      input.label === null ? null : KeyLabel.create(input.label);

    const result = await this.rekeyUseCase.rekey({
      workspaceId,
      currentPassphrase,
      newPassphrase,
      label,
    });

    return {
      workspaceId: workspaceId.toString(),
      newKeyId: result.newEnvelopeId.toString(),
      removedKeyIds: Object.freeze(
        result.removedEnvelopeIds.map((id) => id.toString()),
      ),
      rotatedAt: new Date(result.rotatedAt.toEpochMs()).toISOString(),
    };
  }
}

/**
 * Cross-module facade adapter that fulfils the CLI's
 * {@link AddKeyFacade} port using the encryption module's
 * {@link UnlockEncryption} + {@link AddEnvelope} use cases.
 *
 * Multi-key v0.5+ flow (ADR-005, Phase-22 appendix in
 * `docs/12-lineamientos-arquitectura.md` §1.5.5):
 *
 * 1. Detect the workspace at `rootPath` so the facade can resolve the
 *    canonical `WorkspaceId` without forcing the wire shape to carry
 *    one. Refuses with `CliFacadeNotImplementedError` if no workspace
 *    is found at the supplied path — the CLI's outer error handler
 *    maps the typed failure onto an exit code.
 * 2. Run `UnlockEncryption.unlock(currentPassphrase)` so the in-memory
 *    aggregate is unlocked. ADR-005 Q1 pins the "current passphrase"
 *    check at this boundary; a wrong value surfaces as a
 *    `KeyValidationFailedError` and the envelope list is not touched.
 * 3. Run `AddEnvelope.addEnvelope(newPassphrase, label)`. The use
 *    case persists the new envelope to `config.json` and appends the
 *    audit-log pair (`UnlockSucceeded` + `KeyEnvelopeAdded`).
 *
 * Conversion responsibilities:
 * - `currentPassphrase` / `newPassphrase` strings are wrapped into
 *   the `Passphrase` value object via `Passphrase.from(...)`. The VO
 *   trims whitespace and enforces the 12-char minimum; rejection
 *   surfaces as an `InvalidInputError` the CLI handler maps to an
 *   exit code.
 * - `label` (nullable string) is wrapped into `KeyLabel.create(...)`
 *   when non-null. The VO validates non-empty / single-line / length
 *   cap; rejection surfaces as `InvalidInputError`.
 *
 * The `printableKey` field on the output is intentionally the new
 * envelope id rather than a re-emission of the master key. See the
 * port's {@link AddKeyFacadeOutput} JSDoc for the rationale; the CLI
 * handler renders a Spanish-language "envelope agregado" line above
 * the id, which is enough for the user to confirm the operation
 * without leaking secret material.
 */
export class CliAddKeyFacadeAdapter implements AddKeyFacade {
  public constructor(
    private readonly addEnvelopeUseCase: AddEnvelope,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async add(input: AddKeyFacadeInput): Promise<AddKeyFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "AddKeyFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const workspaceId = detection.workspace.getId();
    const currentPassphrase = Passphrase.from(input.currentPassphrase);
    const newPassphrase = Passphrase.from(input.newPassphrase);
    const label =
      input.label === null ? null : KeyLabel.create(input.label);

    // The use case orchestrates unlock + addEnvelope internally so the
    // unlocked aggregate from UnlockEncryption is the same instance
    // mutated by addEnvelope (aggregates rebuilt-from-JSON via
    // findByWorkspace are always locked; the unlocked master key
    // never persists to disk).
    const addResult = await this.addEnvelopeUseCase.addEnvelope({
      workspaceId,
      currentPassphrase,
      newPassphrase,
      label,
    });

    return {
      workspaceId: workspaceId.toString(),
      keyId: addResult.envelopeId.toString(),
      printableKey: addResult.envelopeId.toString(),
    };
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
 * Adapter for `UninstallHookFacade`. Forwards to the secrets
 * module's `UninstallPreCommitHookUseCase` and translates the
 * uninstall receipt into the CLI's wire shape.
 *
 * Wire-shape contract (`UninstallHookFacadeOutput.removedAt`):
 *   - `null`           — no hook present, or the existing hook was
 *                        foreign and the adapter refused to touch
 *                        it. The CLI handler maps the null branch
 *                        to its idempotent / refusal message.
 *                        We disambiguate the two cases via the
 *                        logger and via the use-case status, but
 *                        the wire shape collapses them into a
 *                        single "no removal performed" signal so
 *                        the CLI surface stays small.
 *   - non-null path    — the hook (or its recall block) was
 *                        removed. The string carries the SANITISED
 *                        path of the hook file the adapter acted
 *                        on, suitable for direct stdout output.
 *
 * Errors:
 *   - `PathSanitizerError` — propagated as a thrown value so the
 *     `RunCliCommandUseCase` maps it to a typed exit code, mirroring
 *     the install-side adapter.
 */
export class CliUninstallHookFacadeAdapter implements UninstallHookFacade {
  public constructor(
    private readonly useCase: UninstallPreCommitHook,
    private readonly logger: Logger,
  ) {}

  public async uninstall(
    input: UninstallHookFacadeInput,
  ): Promise<UninstallHookFacadeOutput> {
    const result = await this.useCase.uninstall({
      workspaceRoot: input.rootPath,
    });
    if (isErr(result)) {
      this.logger.warn(
        { kind: result.error.kind },
        "uninstall-hook rejected by path sanitizer",
      );
      throw result.error;
    }
    const status = result.value.status;
    const hookPath = result.value.hookPath.toString();
    if (status === "removed" || status === "block-removed") {
      return { removedAt: hookPath };
    }
    // status === "not-installed" || status === "not-managed"
    // Collapse both to `null` on the wire — the handler prints a
    // single idempotent message and the logger preserves the
    // distinction for operators inspecting the audit trail.
    return { removedAt: null };
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
 * memory audit alone is sufficient for the MVP `recall audit`
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
 * Adapter for `ResetQueueFacade`. Forwards `recall reset-queue` to the
 * retrieval module's `ResetEmbeddingQueueUseCase`.
 *
 * Recovery for B-MCP-7
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 */
export class CliResetQueueFacadeAdapter implements ResetQueueFacade {
  public constructor(
    private readonly useCase: ResetEmbeddingQueueUseCase,
    private readonly detectWorkspace: DetectWorkspace,
  ) {}

  public async reset(
    input: ResetQueueFacadeInput,
  ): Promise<ResetQueueFacadeOutput> {
    const detection = await this.detectWorkspace.detect({
      startPath: WorkspacePath.create(input.rootPath),
    });
    if (!detection.found) {
      throw new CliFacadeNotImplementedError(
        "ResetQueueFacade",
        `no workspace at ${input.rootPath}`,
      );
    }
    const result = await this.useCase.execute({
      workspaceId: detection.workspace.getId(),
      ...(input.threshold === null
        ? {}
        : { attemptsAtLeast: input.threshold }),
    });
    return {
      resetCount: result.resetCount,
      thresholdApplied: result.attemptsAtLeast,
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
 *   3. Filesystem removal of the entire `.recall/` directory
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
        "use the dedicated recall-server binary instead",
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
 * a canonical `.recall/` path inside a workspace root.
 */
export function workspaceMemoriaDir(rootPath: string): string {
  return path.join(rootPath, ".recall");
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
