/**
 * Test doubles for the workspace module's ports.
 *
 * Each fake captures inputs and returns scripted outcomes so the use
 * case tests can assert "the use case called the right port with the
 * right arguments and translated the result correctly".
 */
import type { Logger } from "../../src/shared/application/ports/logger.port.ts";
import type {
  WorkspaceDetectionResult,
  WorkspaceDetector,
} from "../../src/modules/workspace/domain/services/workspace-detector.ts";
import type { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import type { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import type {
  PersistedWorkspaceConfig,
  WorkspaceFilesystem,
} from "../../src/modules/workspace/application/ports/out/workspace-filesystem.port.ts";
import type {
  DatabaseBootstrap,
  DatabaseBootstrapInput,
  DatabaseBootstrapResult,
  DatabaseProbeResult,
} from "../../src/modules/workspace/application/ports/out/database-bootstrap.port.ts";
import type { InitializeEncryptionFacade } from "../../src/modules/workspace/application/ports/out/initialize-encryption-facade.port.ts";
import type {
  UnlockEncryptionFacade,
  UnlockEncryptionFacadeOutcome,
} from "../../src/modules/workspace/application/ports/out/unlock-encryption-facade.port.ts";
import type {
  LockEncryptionFacade,
  LockEncryptionFacadeOutcome,
} from "../../src/modules/workspace/application/ports/out/lock-encryption-facade.port.ts";
import type {
  DestroyEncryptionFacade,
  DestroyEncryptionTargetMode,
} from "../../src/modules/workspace/application/ports/out/destroy-encryption-facade.port.ts";
import type {
  EmbedderProbe,
  EmbedderProbeOutcome,
} from "../../src/modules/workspace/application/ports/out/embedder-probe.port.ts";
import type {
  UpsertWorkspaceConfigInput,
  WorkspaceProjectionWriter,
} from "../../src/modules/workspace/application/ports/out/workspace-projection-writer.port.ts";

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

export class StubDetector implements WorkspaceDetector {
  public lastInput: WorkspacePath | null = null;
  public constructor(private readonly script: WorkspaceDetectionResult) {}
  public detect(rootPath: WorkspacePath): Promise<WorkspaceDetectionResult> {
    this.lastInput = rootPath;
    return Promise.resolve(this.script);
  }
}

export interface WriteConfigCall {
  readonly rootPath: WorkspacePath;
  readonly config: PersistedWorkspaceConfig;
}

export interface EnsureGitignoreCall {
  readonly rootPath: WorkspacePath;
  readonly mode: WorkspaceMode;
}

export class FakeFilesystem implements WorkspaceFilesystem {
  public existsAnswer = true;
  public readAnswer: PersistedWorkspaceConfig | null = null;
  public readThrows: unknown = null;
  public createCalls: WorkspacePath[] = [];
  public writeCalls: WriteConfigCall[] = [];
  public gitignoreCalls: EnsureGitignoreCall[] = [];
  public removeCalls: WorkspacePath[] = [];
  public removeThrows: unknown = null;

  public removeWorkspaceDirectory(rootPath: WorkspacePath): Promise<void> {
    if (this.removeThrows !== null) {
      const t = this.removeThrows;
      this.removeThrows = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    this.removeCalls.push(rootPath);
    return Promise.resolve();
  }

  public workspaceExists(rootPath: WorkspacePath): Promise<boolean> {
    return Promise.resolve(this.existsAnswer && rootPath.toString() !== "");
  }
  public createWorkspaceDirectory(rootPath: WorkspacePath): Promise<void> {
    this.createCalls.push(rootPath);
    return Promise.resolve();
  }
  public readConfig(rootPath: WorkspacePath): Promise<PersistedWorkspaceConfig> {
    if (this.readThrows !== null) {
      const t = this.readThrows;
      this.readThrows = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    if (this.readAnswer === null) {
      return Promise.reject(new Error(`no readAnswer set for ${rootPath.toString()}`));
    }
    return Promise.resolve(this.readAnswer);
  }
  public writeConfig(
    rootPath: WorkspacePath,
    config: PersistedWorkspaceConfig,
  ): Promise<void> {
    this.writeCalls.push({ rootPath, config });
    return Promise.resolve();
  }
  public ensureGitignore(
    rootPath: WorkspacePath,
    mode: WorkspaceMode,
  ): Promise<void> {
    this.gitignoreCalls.push({ rootPath, mode });
    return Promise.resolve();
  }
}

export class StubDatabaseBootstrap implements DatabaseBootstrap {
  public bootstrapCalls: DatabaseBootstrapInput[] = [];
  public probeCalls: DatabaseBootstrapInput[] = [];
  public bootstrapResult: DatabaseBootstrapResult = { schemaVersion: 0 };
  public probeResult: DatabaseProbeResult = {
    openable: true,
    schemaVersion: 0,
  };
  public probeThrows: unknown = null;

  public bootstrap(
    input: DatabaseBootstrapInput,
  ): Promise<DatabaseBootstrapResult> {
    this.bootstrapCalls.push(input);
    return Promise.resolve(this.bootstrapResult);
  }
  public probe(input: DatabaseBootstrapInput): Promise<DatabaseProbeResult> {
    this.probeCalls.push(input);
    if (this.probeThrows !== null) {
      const t = this.probeThrows;
      this.probeThrows = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve(this.probeResult);
  }
}

export class StubInitEncryption implements InitializeEncryptionFacade {
  public calls: Array<{ workspaceId: string; passphrase: string }> = [];
  public initialize(input: {
    readonly workspaceId: { toString(): string };
    readonly passphrase: string;
  }): Promise<void> {
    this.calls.push({
      workspaceId: input.workspaceId.toString(),
      passphrase: input.passphrase,
    });
    return Promise.resolve();
  }
}

export class StubUnlockEncryption implements UnlockEncryptionFacade {
  public calls: Array<{ workspaceId: string; passphrase: string | null }> = [];
  public outcome: UnlockEncryptionFacadeOutcome = { unlocked: true };
  public unlock(input: {
    readonly workspaceId: { toString(): string };
    readonly passphrase: string | null;
  }): Promise<UnlockEncryptionFacadeOutcome> {
    this.calls.push({
      workspaceId: input.workspaceId.toString(),
      passphrase: input.passphrase,
    });
    return Promise.resolve(this.outcome);
  }
}

export class StubLockEncryption implements LockEncryptionFacade {
  public calls: string[] = [];
  public outcome: LockEncryptionFacadeOutcome = { locked: true };
  public lock(input: {
    readonly workspaceId: { toString(): string };
  }): Promise<LockEncryptionFacadeOutcome> {
    this.calls.push(input.workspaceId.toString());
    return Promise.resolve(this.outcome);
  }
}

export class StubDestroyEncryption implements DestroyEncryptionFacade {
  public calls: Array<{
    workspaceId: string;
    targetMode: DestroyEncryptionTargetMode;
    passphrase: string;
  }> = [];
  public destroy(input: {
    readonly workspaceId: { toString(): string };
    readonly targetMode: DestroyEncryptionTargetMode;
    readonly passphrase: string;
  }): Promise<void> {
    this.calls.push({
      workspaceId: input.workspaceId.toString(),
      targetMode: input.targetMode,
      passphrase: input.passphrase,
    });
    return Promise.resolve();
  }
}

export class StubWorkspaceProjectionWriter
  implements WorkspaceProjectionWriter
{
  public calls: UpsertWorkspaceConfigInput[] = [];
  public throwOn: unknown = null;
  public upsert(input: UpsertWorkspaceConfigInput): Promise<void> {
    if (this.throwOn !== null) {
      const t = this.throwOn;
      this.throwOn = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    this.calls.push(input);
    return Promise.resolve();
  }
}

export class StubEmbedderProbe implements EmbedderProbe {
  public outcome: EmbedderProbeOutcome = {
    ok: true,
    dimension: 384,
    message: "ok",
  };
  public probeThrows: unknown = null;
  public callCount = 0;
  public probe(): Promise<EmbedderProbeOutcome> {
    this.callCount += 1;
    if (this.probeThrows !== null) {
      const t = this.probeThrows;
      this.probeThrows = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve(this.outcome);
  }
}
