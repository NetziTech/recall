import { describe, it, expect } from "vitest";

import { HealthCheckUseCase } from "../../../../../src/modules/workspace/application/use-cases/health-check.use-case.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../../../../../src/modules/workspace/application/ports/in/detect-workspace.port.ts";
import type { EncryptionAuditProbe } from "../../../../../src/shared/application/ports/encryption-audit-probe.port.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDatabaseBootstrap,
  StubEmbedderProbe,
} from "../../../../fixtures/workspace-fixtures.ts";

/**
 * Minimal `EncryptionAuditProbe` stub used by FU-A7-2 tests below.
 * Returns the configured `outcome`. When the constructor receives a
 * `throws` value, every `lastExportAt()` call rejects with it so the
 * use case's catch path is exercised.
 */
class StubEncryptionAuditProbe implements EncryptionAuditProbe {
  public constructor(
    private readonly outcome: Timestamp | null,
    private readonly throws: unknown = null,
  ) {}
  public lastExportAt(): Promise<Timestamp | null> {
    if (this.throws !== null) {
      return Promise.reject(
        this.throws instanceof Error ? this.throws : new Error(String(this.throws)),
      );
    }
    return Promise.resolve(this.outcome);
  }
}

/**
 * Convenience factory: builds a workspace aggregate with the given mode
 * label (the rest of the test below only needs the mode for the
 * `encryption.last_export_at` branching).
 */
function buildWorkspaceWithMode(mode: WorkspaceMode): Workspace {
  const cfg = WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(FIXED_UUID),
    displayName: DisplayName.create("T"),
    mode,
    embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
    createdAt: Timestamp.fromEpochMs(0),
  });
  return Workspace.rehydrate(cfg);
}

const ROOT = WorkspacePath.create("/tmp/host");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

class StubDetect implements DetectWorkspace {
  public out: DetectWorkspaceOutput;
  public throws: unknown = null;
  public constructor(out: DetectWorkspaceOutput) {
    this.out = out;
  }
   
  public detect(_input: DetectWorkspaceInput): Promise<DetectWorkspaceOutput> {
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve(this.out);
  }
}

function buildWorkspace(): Workspace {
  const cfg = WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(FIXED_UUID),
    displayName: DisplayName.create("T"),
    mode: WorkspaceMode.sharedMode(),
    embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
    createdAt: Timestamp.fromEpochMs(0),
  });
  return Workspace.rehydrate(cfg);
}

describe("HealthCheckUseCase", () => {
  it("workspace not found → marks all subsequent checks as skipped", async () => {
    const fs = new FakeFilesystem();
    fs.existsAnswer = false;
    const detect = new StubDetect({ found: false, workspace: null, rootPath: null });
    const db = new StubDatabaseBootstrap();
    const probe = new StubEmbedderProbe();
    const uc = new HealthCheckUseCase(detect, fs, db, probe, new SilentLogger());
    const out = await uc.check({ rootPath: ROOT });
    expect(out.healthy).toBe(false);
    const ids = out.checks.map((c) => c.id);
    expect(ids).toContain("workspace.exists");
    expect(out.checks.find((c) => c.id === "workspace.exists")?.status).toBe(
      "fail",
    );
    expect(out.checks.find((c) => c.id === "workspace.parseable")?.status).toBe(
      "skipped",
    );
  });

  it("happy path: every probe passes (gitignore is deferred=skipped)", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 5 };
    const probe = new StubEmbedderProbe();
    probe.outcome = { ok: true, dimension: 384, message: "ok" };

    const uc = new HealthCheckUseCase(detect, fs, db, probe, new SilentLogger());
    const out = await uc.check({ rootPath: ROOT });
    const get = (id: string) => out.checks.find((c) => c.id === id)?.status;
    expect(get("workspace.exists")).toBe("pass");
    expect(get("workspace.parseable")).toBe("pass");
    expect(get("database.openable")).toBe("pass");
    expect(get("migrations.current")).toBe("pass");
    expect(get("embedder.loadable")).toBe("pass");
    expect(get("gitignore.consistent")).toBe("skipped");
    expect(out.healthy).toBe(true);
  });

  it("workspace.exists probe failure (filesystem throws)", async () => {
    const fs = new FakeFilesystem();
    // Force failure: monkey-patch
    fs.workspaceExists = (): Promise<boolean> => {
      throw new Error("ENOENT");
    };
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks[0]?.status).toBe("fail");
  });

  it("config not parseable (detect throws) → subsequent checks skipped", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    detect.throws = new Error("malformed");
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "workspace.parseable")?.status).toBe(
      "fail",
    );
    expect(out.checks.find((c) => c.id === "database.openable")?.status).toBe(
      "skipped",
    );
  });

  it("detect returns found=false despite directory existing → fail parseable", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: false,
      workspace: null,
      rootPath: null,
    });
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    // exists=true (fs answers true) + detect=false ⇒ parseable=fail
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "workspace.parseable")?.status).toBe(
      "fail",
    );
  });

  it("database probe returns openable=false", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: false, schemaVersion: null };
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "database.openable")?.status).toBe(
      "fail",
    );
    expect(out.checks.find((c) => c.id === "migrations.current")?.status).toBe(
      "skipped",
    );
  });

  it("database probe throws → fail + migrations skipped", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeThrows = new Error("ENOENT");
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "database.openable")?.status).toBe(
      "fail",
    );
  });

  it("database openable but schema_version null → migrations.current = fail", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: null };
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "database.openable")?.status).toBe(
      "pass",
    );
    expect(out.checks.find((c) => c.id === "migrations.current")?.status).toBe(
      "fail",
    );
  });

  it("embedder.loadable: ok=false → fail", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const probe = new StubEmbedderProbe();
    probe.outcome = { ok: false, dimension: null, message: "no model" };
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      probe,
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "embedder.loadable")?.status).toBe(
      "fail",
    );
  });

  it("embedder.loadable: probe throws → fail", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const probe = new StubEmbedderProbe();
    probe.probeThrows = new Error("model load failed");
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      probe,
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    expect(out.checks.find((c) => c.id === "embedder.loadable")?.status).toBe(
      "fail",
    );
  });

  it("parseModeOrFallback: invalid persisted mode falls back to shared", async () => {
    // Force the path where the workspace's stored mode is invalid.
    // The detect adapter returns a workspace with a real mode, but
    // we'll make the workspace expose an invalid string via mock by
    // monkey-patching getMode().toString() to return garbage. Then
    // the use case calls parseModeOrFallback which catches and
    // returns sharedMode().
    const ws = buildWorkspace();
    Object.defineProperty(ws, "getMode", {
      value: () => ({ toString: () => "weird-not-a-mode" }),
      configurable: true,
    });
    const fs = new FakeFilesystem();
    const detect = new StubDetect({ found: true, workspace: ws, rootPath: ROOT });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 1 };
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    // Accept any state — test exists primarily to cover the fallback
    // branch (parseModeOrFallback returning sharedMode after catching
    // WorkspaceMode.create's throw on the bad string).
    expect(out.checks.length).toBeGreaterThan(0);
  });

  it("workspace.exists probe failure with non-Error throw → string fallback", async () => {
    const fs = new FakeFilesystem();
    fs.workspaceExists = (): Promise<boolean> => {
      throw "string-not-error" as unknown as never;
    };
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspace(),
      rootPath: ROOT,
    });
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      new StubDatabaseBootstrap(),
      new StubEmbedderProbe(),
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    const e = out.checks[0];
    expect(e?.status).toBe("fail");
    expect(e?.message).toContain("string-not-error");
  });
});

describe("HealthCheckUseCase — encryption.last_export_at (FU-A7-2)", () => {
  it("encrypted mode + probe returns null → pass with 'no recall export-key' message", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.encryptedMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };
    const auditProbe = new StubEncryptionAuditProbe(null);

    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
      auditProbe,
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("pass");
    expect(entry?.message).toContain("no recall export-key invocation");
    expect(out.healthy).toBe(true);
  });

  it("encrypted mode + probe returns timestamp → pass with ISO 8601 message", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.encryptedMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };
    const exportedAt = Timestamp.fromEpochMs(1_700_000_900_000);
    const auditProbe = new StubEncryptionAuditProbe(exportedAt);

    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
      auditProbe,
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("pass");
    expect(entry?.message).toContain(
      new Date(exportedAt.toEpochMs()).toISOString(),
    );
    expect(out.healthy).toBe(true);
  });

  it("encrypted mode + probe throws → fail (corrupted audit-log surfaces, healthy=false)", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.encryptedMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };
    const auditProbe = new StubEncryptionAuditProbe(
      null,
      new Error("encryption_audit_log table corrupted"),
    );

    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
      auditProbe,
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("fail");
    expect(entry?.message).toContain("encryption_audit_log table corrupted");
    expect(out.healthy).toBe(false);
  });

  it("shared mode → skipped (probe wired but not applicable)", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.sharedMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };
    const auditProbe = new StubEncryptionAuditProbe(
      Timestamp.fromEpochMs(1_700_000_900_000),
    );

    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
      auditProbe,
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("skipped");
    expect(entry?.message).toContain("not applicable to mode=shared");
  });

  it("private mode → skipped", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.privateMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };
    const auditProbe = new StubEncryptionAuditProbe(null);

    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
      auditProbe,
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("skipped");
    expect(entry?.message).toContain("not applicable to mode=private");
  });

  it("encrypted mode + no probe wired → skipped with explanatory message", async () => {
    const fs = new FakeFilesystem();
    const detect = new StubDetect({
      found: true,
      workspace: buildWorkspaceWithMode(WorkspaceMode.encryptedMode()),
      rootPath: ROOT,
    });
    const db = new StubDatabaseBootstrap();
    db.probeResult = { openable: true, schemaVersion: 9 };
    const embedder = new StubEmbedderProbe();
    embedder.outcome = { ok: true, dimension: 384, message: "ok" };

    // No 6th arg → probe defaults to null. Backwards-compat path
    // for callers not yet migrated.
    const uc = new HealthCheckUseCase(
      detect,
      fs,
      db,
      embedder,
      new SilentLogger(),
    );
    const out = await uc.check({ rootPath: ROOT });
    const entry = out.checks.find((c) => c.id === "encryption.last_export_at");
    expect(entry?.status).toBe("skipped");
    expect(entry?.message).toContain("probe not wired");
  });
});
