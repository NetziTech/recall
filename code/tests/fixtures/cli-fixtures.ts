/**
 * Test doubles for the CLI module's facades + tty ports.
 */
import type { Logger } from "../../src/shared/application/ports/logger.port.ts";
import type {
  Prompt,
  Stderr,
  Stdout,
} from "../../src/modules/cli/application/ports/out/tty.port.ts";
import type {
  ChangeModeFacade,
  ChangeModeFacadeInput,
  ChangeModeFacadeOutput,
  HealthCheckFacade,
  HealthCheckFacadeInput,
  HealthCheckFacadeOutput,
  InitializeWorkspaceFacade,
  InitializeWorkspaceFacadeInput,
  InitializeWorkspaceFacadeOutput,
  LockWorkspaceFacade,
  LockWorkspaceFacadeInput,
  LockWorkspaceFacadeOutput,
  UnlockWorkspaceFacade,
  UnlockWorkspaceFacadeInput,
  UnlockWorkspaceFacadeOutput,
} from "../../src/modules/cli/application/ports/out/workspace-facade.port.ts";
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
} from "../../src/modules/cli/application/ports/out/encryption-facade.port.ts";
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
} from "../../src/modules/cli/application/ports/out/secrets-facade.port.ts";
import type {
  CuratorLogFacade,
  CuratorLogFacadeInput,
  CuratorLogFacadeOutput,
  CuratorRunFacade,
  CuratorRunFacadeInput,
  CuratorRunFacadeOutput,
} from "../../src/modules/cli/application/ports/out/curator-facade.port.ts";
import type {
  ResetQueueFacade,
  ResetQueueFacadeInput,
  ResetQueueFacadeOutput,
} from "../../src/modules/cli/application/ports/out/embedding-queue-facade.port.ts";
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
  StatsFacade,
  StatsFacadeInput,
  StatsFacadeOutput,
  WipeFacade,
  WipeFacadeInput,
  WipeFacadeOutput,
} from "../../src/modules/cli/application/ports/out/maintenance-facade.port.ts";

export class SilentLogger implements Logger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
  public fatal(): void {}
  public child(): Logger {
    return this;
  }
}

export class RecordingStdout implements Stdout {
  public chunks: string[] = [];
  public write(text: string): void {
    this.chunks.push(text);
  }
  public buffer(): string {
    return this.chunks.join("");
  }
}

export class RecordingStderr implements Stderr {
  public chunks: string[] = [];
  public write(text: string): void {
    this.chunks.push(text);
  }
  public buffer(): string {
    return this.chunks.join("");
  }
}

export class ScriptedPrompt implements Prompt {
  public readonly lines: string[];
  public readonly passphrases: string[];
  public readonly confirms: boolean[];
  public lineIndex = 0;
  public passIndex = 0;
  public confirmIndex = 0;
  public constructor(
    opts: {
      lines?: readonly string[];
      passphrases?: readonly string[];
      confirms?: readonly boolean[];
    } = {},
  ) {
    this.lines = [...(opts.lines ?? [])];
    this.passphrases = [...(opts.passphrases ?? [])];
    this.confirms = [...(opts.confirms ?? [])];
  }
   
  public confirm(_q: string): Promise<boolean> {
    const v = this.confirms[this.confirmIndex];
    this.confirmIndex += 1;
    return Promise.resolve(v ?? false);
  }
   
  public readLine(_q: string): Promise<string> {
    const v = this.lines[this.lineIndex];
    this.lineIndex += 1;
    return Promise.resolve(v ?? "");
  }
   
  public readPassphrase(_q: string): Promise<string> {
    const v = this.passphrases[this.passIndex];
    this.passIndex += 1;
    return Promise.resolve(v ?? "");
  }
}

// ─── Workspace facades ────────────────────────────────────────────────

export class StubInitializeWorkspaceFacade implements InitializeWorkspaceFacade {
  public lastInput?: InitializeWorkspaceFacadeInput;
  public output: InitializeWorkspaceFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    mode: "shared",
    wasCreated: true,
  };
  public throws: unknown = null;
  public initialize(
    input: InitializeWorkspaceFacadeInput,
  ): Promise<InitializeWorkspaceFacadeOutput> {
    this.lastInput = input;
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve(this.output);
  }
}

export class StubUnlockWorkspaceFacade implements UnlockWorkspaceFacade {
  public lastInput?: UnlockWorkspaceFacadeInput;
  public output: UnlockWorkspaceFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    wasUnlocked: true,
    mode: "encrypted",
  };
  public unlock(
    input: UnlockWorkspaceFacadeInput,
  ): Promise<UnlockWorkspaceFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubLockWorkspaceFacade implements LockWorkspaceFacade {
  public lastInput?: LockWorkspaceFacadeInput;
  public output: LockWorkspaceFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    wasLocked: true,
  };
  public lock(
    input: LockWorkspaceFacadeInput,
  ): Promise<LockWorkspaceFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubChangeModeFacade implements ChangeModeFacade {
  public lastInput?: ChangeModeFacadeInput;
  public output: ChangeModeFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    newMode: "private",
  };
  public change(
    input: ChangeModeFacadeInput,
  ): Promise<ChangeModeFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubHealthCheckFacade implements HealthCheckFacade {
  public lastInput?: HealthCheckFacadeInput;
  public output: HealthCheckFacadeOutput = {
    checks: [
      { id: "workspace.exists", status: "pass", message: "ok" },
      { id: "embedder.loadable", status: "fail", message: "no model" },
    ],
    healthy: false,
  };
  public check(
    input: HealthCheckFacadeInput,
  ): Promise<HealthCheckFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

// ─── Encryption facades ───────────────────────────────────────────────

export class StubExportKeyFacade implements ExportKeyFacade {
  public lastInput?: ExportKeyFacadeInput;
  public output: ExportKeyFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    printableMasterKey: "m3-zk7l-xxxx-yyyy",
    exportedAt: "2026-05-12T00:00:00.000Z",
  };
  public export(
    input: ExportKeyFacadeInput,
  ): Promise<ExportKeyFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubRekeyFacade implements RekeyFacade {
  public lastInput?: RekeyFacadeInput;
  public output: RekeyFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    newKeyId: "00000000-0000-7000-8000-000000000099",
    removedKeyIds: ["00000000-0000-7000-8000-00000000aaaa"],
    rotatedAt: "2026-05-12T00:00:00.000Z",
  };
  public rekey(input: RekeyFacadeInput): Promise<RekeyFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubAddKeyFacade implements AddKeyFacade {
  public lastInput?: AddKeyFacadeInput;
  public output: AddKeyFacadeOutput = {
    workspaceId: "00000000-0000-7000-8000-000000000001",
    keyId: "K-1",
    printableKey: "M3-EXTRA",
  };
  public add(input: AddKeyFacadeInput): Promise<AddKeyFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

// ─── Secrets facades ──────────────────────────────────────────────────

export class StubAuditFacade implements AuditFacade {
  public lastInput?: AuditFacadeInput;
  public output: AuditFacadeOutput = { findings: [], hasCritical: false };
  public audit(input: AuditFacadeInput): Promise<AuditFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubSanitizeFacade implements SanitizeFacade {
  public lastInput?: SanitizeFacadeInput;
  public output: SanitizeFacadeOutput = {
    entryId: "id-1",
    redactedPaths: ["a", "b"],
  };
  public sanitize(
    input: SanitizeFacadeInput,
  ): Promise<SanitizeFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubInstallHookFacade implements InstallHookFacade {
  public lastInput?: InstallHookFacadeInput;
  public output: InstallHookFacadeOutput = {
    installedAt: "/path/.git/hooks/pre-commit",
  };
  public install(
    input: InstallHookFacadeInput,
  ): Promise<InstallHookFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubUninstallHookFacade implements UninstallHookFacade {
  public lastInput?: UninstallHookFacadeInput;
  public output: UninstallHookFacadeOutput = { removedAt: null };
  public uninstall(
    input: UninstallHookFacadeInput,
  ): Promise<UninstallHookFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

// ─── Curator facades ──────────────────────────────────────────────────

export class StubCuratorRunFacade implements CuratorRunFacade {
  public lastInput?: CuratorRunFacadeInput;
  public output: CuratorRunFacadeOutput = {
    runId: "run-1",
    entriesScanned: 100,
    entriesPruned: 5,
    learningsConsolidated: 2,
    durationMs: 1234,
  };
  public run(input: CuratorRunFacadeInput): Promise<CuratorRunFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubCuratorLogFacade implements CuratorLogFacade {
  public lastInput?: CuratorLogFacadeInput;
  public output: CuratorLogFacadeOutput = { entries: [] };
  public log(
    input: CuratorLogFacadeInput,
  ): Promise<CuratorLogFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubResetQueueFacade implements ResetQueueFacade {
  public lastInput?: ResetQueueFacadeInput;
  public output: ResetQueueFacadeOutput = {
    resetCount: 0,
    thresholdApplied: 5,
  };
  public reset(input: ResetQueueFacadeInput): Promise<ResetQueueFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

// ─── Maintenance facades ──────────────────────────────────────────────

export class StubImportHandoffFacade implements ImportHandoffFacade {
  public lastInput?: ImportHandoffFacadeInput;
  public output: ImportHandoffFacadeOutput = {
    importedDecisions: 3,
    importedLearnings: 5,
    skippedSections: 1,
  };
  public importHandoff(
    input: ImportHandoffFacadeInput,
  ): Promise<ImportHandoffFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubExportFacade implements ExportFacade {
  public lastInput?: ExportFacadeInput;
  public output: ExportFacadeOutput = {
    outputPath: "/tmp/exp.json",
    bytesWritten: 1024,
  };
  public export(input: ExportFacadeInput): Promise<ExportFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubImportFacade implements ImportFacade {
  public lastInput?: ImportFacadeInput;
  public output: ImportFacadeOutput = {
    inputPath: "/tmp/imp.json",
    importedRows: 99,
  };
  public import(input: ImportFacadeInput): Promise<ImportFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubWipeFacade implements WipeFacade {
  public lastInput?: WipeFacadeInput;
  public output: WipeFacadeOutput = { removedPath: "/tmp/.recall" };
  public wipe(input: WipeFacadeInput): Promise<WipeFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubStatsFacade implements StatsFacade {
  public lastInput?: StatsFacadeInput;
  public output: StatsFacadeOutput = {
    decisions: 1,
    learnings: 2,
    entities: 3,
    tasks: 4,
    turns: 5,
    sessions: 6,
    embeddingsQueued: 7,
    diskBytes: 8,
    lastCuratorRunMs: 9,
  };
  public stats(input: StatsFacadeInput): Promise<StatsFacadeOutput> {
    this.lastInput = input;
    return Promise.resolve(this.output);
  }
}

export class StubServerFacade implements ServerFacade {
  public callCount = 0;
  public exitCode = 0;
  public throws: unknown = null;
  public start(): Promise<{ readonly exitCode: number }> {
    this.callCount += 1;
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve({ exitCode: this.exitCode });
  }
}
